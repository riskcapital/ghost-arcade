/**
 * The SVG layer in the project store: how a new one starts, how an older
 * project's SVG layers open, and that its edits are undo steps.
 *
 * The harness wires history as App.svelte does (see historyGranularity.test.ts).
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

// ── App.svelte's wiring ────────────────────────────────────────────────
type Captured = { project: any; keyframes: unknown; output: any };
const project = () => layers.project;
function capture(): Captured {
  return { project: get(layers.project), keyframes: keyframes.keyframeTimeline.exportAll(), output: settingsModule.settings.captureOutputHistory() };
}
function commit(c: unknown) {
  const state = c as Captured;
  historyModule.history.record(state.project, state.keyframes, state.output);
}
function resetHistory() {
  hooks.cancelPendingHistorySnapshot();
  const state = capture();
  historyModule.history.init(state.project, state.keyframes, state.output);
}
function wireHistory() {
  hooks.setHistoryCallback(() => commit(capture()), {
    capture,
    commit,
    amend: () => {
      const state = capture();
      historyModule.history.amend(state.project, state.keyframes, state.output);
    },
    amendTo: (c: unknown) => {
      const state = c as Captured;
      historyModule.history.amend(state.project, state.keyframes, state.output, { live: true });
    },
  });
  hooks.setProjectReplacedCallback(() => queueMicrotask(resetHistory));
}
function apply(step: import('./history').HistorySnapshot | null) {
  if (!step) return false;
  layers.project.set(step.project);
  hooks.beginHistoryRestore();
  try {
    keyframes.keyframeTimeline.importAll(Array.isArray(step.keyframes) ? step.keyframes as any : []);
  } finally {
    hooks.endHistoryRestore();
  }
  return true;
}
function undo() {
  hooks.flushPendingHistorySnapshot();
  const moved = apply(historyModule.history.undo(get(layers.project)));
  if (moved) hooks.noteLiveChange();
  return moved;
}
function redo() {
  hooks.flushPendingHistorySnapshot();
  const moved = apply(historyModule.history.redo(get(layers.project)));
  if (moved) hooks.noteLiveChange();
  return moved;
}
const steps = () => get(historyModule.history).past.length;
const layerById = (id: string) => get(layers.project).layers.find((l) => l.id === id);

function projectPayload(name: string, layerList: any[] = []) {
  return { version: '2.1.10', project: { id: name, name, width: 1920, height: 1080, layers: layerList } };
}

async function openProject(name: string, layerList: any[] = []) {
  expect(layers.project.importProject(projectPayload(name, layerList))).toBe(true);
  await Promise.resolve();
  await Promise.resolve();
}

const SQUARE = '<svg viewBox="0 0 10 10"><rect width="8" height="8"/></svg>';

beforeEach(async () => {
  wireHistory();
  const svg = types.createLayer('s', 'S', 'svg');
  svg.svgContent = { ...svg.svgContent!, svgSource: SQUARE };
  await openProject('start', [svg]);
  resetHistory();
});

afterEach(() => {
  vi.useRealTimers();
  hooks.cancelPendingHistorySnapshot();
  hooks.setHistoryCallback(() => {});
  hooks.setProjectReplacedCallback(null);
});

describe('a new SVG layer', () => {
  it('shows the artwork as drawn, on Normal blend', () => {
    layers.project.addSVGLayer('Fresh');
    const fresh = get(layers.project).layers.find((l) => l.name === 'Fresh')!;
    expect(fresh.blendMode).toBe('normal');
    expect(fresh.svgContent!.renderMode).toBe('source');
    expect(fresh.svgContent!.bloomStrength).toBe(0);
    expect(fresh.svgContent!.glowEnabled).toBe(false);
  });
});

describe('opening an older project', () => {
  it('keeps what an SVG layer had and fills in what it left out', async () => {
    const old = { ...types.createLayer('old', 'Old', 'svg'), blendMode: 'add' };
    old.svgContent = { svgSource: SQUARE, renderMode: 'flat', bloomStrength: 1.8, glowEnabled: true } as any;
    await openProject('old', [old]);
    const layer = layerById('old')!;
    expect(layer.blendMode).toBe('add');
    expect(layer.svgContent!.renderMode).toBe('flat');
    expect(layer.svgContent!.bloomStrength).toBe(1.8);
    expect(layer.svgContent!.glowEnabled).toBe(true);
    // Left out: what the renderer drew for it, and a value the panel can show.
    expect(layer.svgContent!.liquidEnabled).toBe(false);
    expect(typeof layer.svgContent!.liquidSpeed).toBe('number');
    expect(typeof layer.svgContent!.extrudeDepth).toBe('number');
  });

  it('opens an SVG layer saved with no settings at all', async () => {
    const bare = { ...types.createLayer('bare', 'Bare', 'svg'), svgContent: undefined };
    await openProject('bare', [bare]);
    expect(layerById('bare')!.svgContent!.svgSource).toBe('');
  });
});

describe('SVG edits are undo steps', () => {
  it('records a fill mode and a color mode change', () => {
    vi.useFakeTimers();
    layers.project.setSVGFillMode('s', 'gradient');
    vi.advanceTimersByTime(700);
    layers.project.setSVGColorMode('s', 'rainbow');
    vi.advanceTimersByTime(700);
    expect(steps()).toBe(2);
    undo();
    expect(layerById('s')!.svgContent!.colorMode).not.toBe('rainbow');
    expect(layerById('s')!.svgContent!.fillMode).toBe('gradient');
    undo();
    expect(layerById('s')!.svgContent!.fillMode).not.toBe('gradient');
  });

  it('makes a gizmo drag one step, even when it rests on the way', () => {
    vi.useFakeTimers();
    // What the transform gizmo does: a gesture round the debounced edits.
    hooks.beginGesture();
    layers.project.updateSVGContent('s', { panX: 0.2 });
    vi.advanceTimersByTime(1500); // held still mid-drag
    layers.project.updateSVGContent('s', { panX: 0.4 });
    vi.advanceTimersByTime(100);
    hooks.endGesture(true);
    vi.advanceTimersByTime(700);
    expect(steps()).toBe(1);
    undo();
    expect(layerById('s')!.svgContent!.panX).toBe(0);
  });
});
