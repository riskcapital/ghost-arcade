/**
 * Opening a project starts its undo history over.
 *
 * The history was initialised once, at launch, and only cleared by New. Every
 * other way of opening a project (File, Open Recent, recovery, relink, a
 * package) left the previous project's steps in place, so the first Cmd/Ctrl+Z
 * after opening brought the previous project back. New cleared the history to
 * nothing, so the first edit after it could not be undone at all.
 *
 * The harness wires history as App.svelte does.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

let layers: typeof import('./layers');
let types: typeof import('../types');
let historyModule: typeof import('./history');
let hooks: typeof import('./historyHooks');
let keyframes: typeof import('./keyframeTimeline');
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
  (globalThis as any).dispatchEvent = () => true;
  (globalThis as any).CustomEvent ??= class extends Event {
    detail: unknown;
    constructor(name: string, options: any) { super(name); this.detail = options.detail; }
  };
  (globalThis as any).matchMedia = () => ({
    matches: false,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {},
  });
  (globalThis as any).requestAnimationFrame = (cb: (t: number) => void) =>
    setTimeout(() => cb(Date.now()), 0) as unknown as number;
  (globalThis as any).cancelAnimationFrame = (id: number) => clearTimeout(id as never);
}

beforeAll(async () => {
  installDomShim();
  layers = await import('./layers');
  types = await import('../types');
  historyModule = await import('./history');
  hooks = await import('./historyHooks');
  keyframes = await import('./keyframeTimeline');
  settingsModule = await import('./settings');
});

const record = () => historyModule.history.record(
  get(layers.project), keyframes.keyframeTimeline.exportAll(), settingsModule.settings.captureOutputHistory());
function resetHistory() {
  hooks.cancelPendingHistorySnapshot();
  historyModule.history.init(
    get(layers.project), keyframes.keyframeTimeline.exportAll(), settingsModule.settings.captureOutputHistory());
}
function undo() {
  hooks.flushPendingHistorySnapshot();
  const step = historyModule.history.undo(get(layers.project));
  if (step) layers.project.set(step.project);
  return !!step;
}
const steps = () => get(historyModule.history).past.length;

async function openProject(name: string, layerList: any[] = []) {
  const payload = { version: '2.1.10', project: { id: name, name, width: 1920, height: 1080, layers: layerList } };
  expect(layers.project.importProject(payload)).toBe(true);
  await Promise.resolve();
}

beforeEach(async () => {
  hooks.setHistoryCallback(record);
  hooks.setProjectReplacedCallback(() => queueMicrotask(resetHistory));
  await openProject('first', [types.createLayer('a', 'A', 'color')]);
});

afterEach(() => {
  vi.useRealTimers();
  hooks.cancelPendingHistorySnapshot();
  hooks.setHistoryCallback(() => {});
  hooks.setProjectReplacedCallback(null);
});

describe('opening a project starts its undo history over', () => {
  it('cannot undo back into the project that was open before', async () => {
    layers.project.addColorLayer('Extra');
    expect(steps()).toBe(1);
    await openProject('second', [types.createLayer('c', 'C', 'color')]);
    expect(steps()).toBe(0);
    expect(undo()).toBe(false);
    expect(get(layers.project).name).toBe('second');
  });

  it('counts what the opening path does right after the import as the starting point', async () => {
    expect(layers.project.importProject({ version: '2.1.10', project: { id: 'x', name: 'Untitled Project', layers: [] } })).toBe(true);
    // App names the project after its file in the same task as the import.
    layers.project.setProjectName('Show file');
    await Promise.resolve();
    expect(steps()).toBe(0);
    layers.project.addColorLayer('Extra');
    undo();
    expect(get(layers.project).name).toBe('Show file');
  });

  it('drops an edit still waiting for its debounce, which belonged to the old project', async () => {
    vi.useFakeTimers();
    layers.project.updateLayer('a', { opacity: 0.3 });
    await openProject('second', [types.createLayer('c', 'C', 'color')]);
    vi.advanceTimersByTime(1000);
    expect(steps()).toBe(0);
  });

  it('keeps the history when another window relays live state', async () => {
    layers.project.addColorLayer('Extra');
    const live = JSON.parse(JSON.stringify(layers.project.exportProject()));
    expect(layers.project.importProject(live, undefined, { live: true })).toBe(true);
    await Promise.resolve();
    expect(steps()).toBe(1);
  });

  it('lets the first edit after New be undone', () => {
    layers.project.newProject('Fresh');
    resetHistory();
    layers.project.addColorLayer('First');
    expect(get(layers.project).layers).toHaveLength(1);
    expect(undo()).toBe(true);
    expect(get(layers.project).layers).toHaveLength(0);
  });
});
