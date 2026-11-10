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
    expect(saved.version).toBe('1.9.6');
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

  it('saves layer tracks (version 3) and brings them back with their media', async () => {
    const { project } = layers;
    const { showTimeline } = showTimelineStore;
    await buildShow();
    const trackId = showTimeline.addLayerTrack({ id: 'wall', name: 'Wall', type: 'media', opacity: 1, source: null } as any);
    showTimeline.addLayerClip(trackId, {
      kind: 'video',
      name: 'ramp.mp4',
      src: 'blob:http://localhost:1420/ramp-runtime',
      _assetRef: { kind: 'local-file', originalPath: '/Users/x/clips/ramp.mp4', name: 'ramp.mp4' },
      sourceDuration: 10,
    }, 5, { endBehaviour: 'loop', duration: 30, fadeOut: 2 });
    showTimeline.setTempo({ offset: 0.5, segments: [{ bar: 1, bpm: 124, beatsPerBar: 4, beatUnit: 4 }], source: 'manual' });

    const saved = JSON.parse(JSON.stringify(await project.exportProjectForSave())) as any;
    expect(saved.project.showTimeline.version).toBe(5);
    const savedClip = saved.project.showTimeline.layerTracks[0].clips[0];
    expect(savedClip.media.src).toBe('');
    expect(savedClip.media._assetRef.originalPath).toBe('/Users/x/clips/ramp.mp4');

    showTimeline._resetForTest();
    expect(project.importProject(saved, '/Users/x/projects/show1')).toBe(true);
    await flushMicrotasks();
    const after = get(showTimeline);
    expect(after.layerTracks).toHaveLength(1);
    expect(after.layerTracks[0]).toMatchObject({ layerId: 'wall', layerName: 'Wall', gap: 'hide' });
    const clip = after.layerTracks[0].clips[0];
    expect(clip).toMatchObject({ startTime: 5, duration: 30, endBehaviour: 'loop', fadeOut: 2 });
    expect(clip.media.src).toContain('ramp.mp4');
    expect(clip.media.src).not.toContain('blob:');
    expect(after.tempo?.segments[0].bpm).toBe(124);
    expect(after.duration).toBe(135);
  });

  it('opens a version 1 show as it was, with no tracks and no grid', async () => {
    const { project } = layers;
    const { showTimeline } = showTimelineStore;
    const v1 = {
      version: '1.9.5',
      project: {
        id: 'p', name: 'v1', width: 1920, height: 1080, layers: [],
        showTimeline: {
          version: 1, isOpen: true, loop: true, zoom: 12, snapEnabled: true,
          audioTracks: [],
          presetClips: [{ id: 'c1', compositionId: 'comp', startTime: 0, duration: 20, transitionIn: 'cut', transitionDuration: 1 }],
        },
      },
    };
    expect(project.importProject(v1, '/Users/x/projects/v1')).toBe(true);
    await flushMicrotasks();
    const after = get(showTimeline);
    expect(after.presetClips.map((c) => [c.id, c.startTime, c.duration, c.transitionIn])).toEqual([['c1', 0, 20, 'cut']]);
    expect(after.layerTracks).toEqual([]);
    expect(after.tempo).toBeNull();
    expect(after.cameraLane).toEqual([]);
    expect(after.duration).toBe(20);
    expect(after.loop).toBe(true);
  });

  it('carries the camera lane\'s shots, so another machine finds them (they said "Missing shot")', async () => {
    const { project } = layers;
    const { showTimeline } = showTimelineStore;
    const { demoReel } = await import('../stage3d/demoReel');
    demoReel.clear();
    const cam = { position: [0, 2, 12] as [number, number, number], target: [0, 1, 0] as [number, number, number], fov: 45 };
    const shot = demoReel.addShot(cam, { schemaVersion: 1, nodes: [] } as never, 'orbit');
    const unused = demoReel.addShot(cam, { schemaVersion: 1, nodes: [] } as never, 'static');
    showTimeline.setCameraLane([{ id: 'cc1', startTime: 2, duration: 6, shotId: shot.id }]);
    const saved = JSON.parse(JSON.stringify(await project.exportProjectForSave())) as any;
    const table = saved.project.showTimeline.cameraShots;
    // Only the shots the lane uses.
    expect(table.map((s: { id: string }) => s.id)).toEqual([shot.id]);
    expect(table[0]).toMatchObject({ moveId: 'orbit', from: shot.from, to: shot.to });

    // Another machine: its Demo Reel has none of these shots.
    demoReel.clear();
    expect(get(demoReel).shots).toEqual([]);
    expect(project.importProject(saved, '/Users/y/projects')).toBe(true);
    await flushMicrotasks();
    expect(get(showTimeline).cameraLane.map((c) => c.shotId)).toEqual([shot.id]);
    const adopted = get(demoReel).shots;
    expect(adopted.map((s) => s.id)).toEqual([shot.id]);
    expect(adopted[0].from).toEqual(shot.from);
    expect(adopted.some((s) => s.id === unused.id)).toBe(false);
    // Opening it again adds nothing twice; a local shot of the same id wins.
    demoReel.updateShot(shot.id, { name: 'Edited here' });
    expect(project.importProject(saved, '/Users/y/projects')).toBe(true);
    await flushMicrotasks();
    expect(get(demoReel).shots.map((s) => [s.id, s.name])).toEqual([[shot.id, 'Edited here']]);
    // A file from before the table: the lane loads, the reel is left alone.
    delete saved.project.showTimeline.cameraShots;
    demoReel.clear();
    expect(project.importProject(saved, '/Users/y/projects')).toBe(true);
    await flushMicrotasks();
    expect(get(showTimeline).cameraLane).toHaveLength(1);
    expect(get(demoReel).shots).toEqual([]);
    demoReel.clear();
  });

  it('keeps the show out of the live sync export (save-only section)', async () => {
    const { project } = layers;
    await buildShow();
    const sync = project.exportProject() as any;
    // Same treatment as stage3d / projectionSim: the relay must not carry it.
    expect(sync.project.showTimeline).toBeUndefined();
    expect(sync.version).toBe('1.9.6');
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

    // The relay receiver marks its payloads live (stateBroadcast.ts).
    expect(project.importProject(relayPayload, undefined, { live: true })).toBe(true);
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
