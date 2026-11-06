import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dropSketchDraft, keepSketchDraft, readSketchDraft } from './sketchDrafts';

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => { data.delete(key); },
    setItem: (key, value) => { data.set(key, String(value)); },
  };
}

describe('sketch drafts', () => {
  beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()));
  afterEach(() => vi.unstubAllGlobals());

  const saved = { 'sketch.js': 'function draw() {}', 'index.html': '<html></html>' };
  const typed = { ...saved, 'sketch.js': 'function draw() {\n  while (y < height) { line(0, y, width, y); }\n}' };

  it('brings back what was typed over the files the sketch still holds', () => {
    keepSketchDraft('source:a', saved, typed);
    expect(readSketchDraft('source:a', saved)).toEqual(typed);
  });

  it('drops a draft typed over files that have changed since', () => {
    keepSketchDraft('source:a', saved, typed);
    const savedElsewhere = { ...saved, 'sketch.js': 'function draw() { background(0); }' };
    expect(readSketchDraft('source:a', savedElsewhere)).toBeNull();
    expect(readSketchDraft('source:a', saved)).toBeNull();
  });

  it('has nothing to bring back once saved or let go', () => {
    keepSketchDraft('source:a', saved, typed);
    dropSketchDraft('source:a');
    expect(readSketchDraft('source:a', saved)).toBeNull();
    keepSketchDraft('source:b', saved, saved);
    expect(readSketchDraft('source:b', saved)).toBeNull();
  });

  it('keeps only the files the sketch has', () => {
    keepSketchDraft('item:x', saved, { ...typed, 'other.js': 'boom()' });
    expect(readSketchDraft('item:x', saved)).toEqual(typed);
  });

  it('works without storage', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(() => keepSketchDraft('source:a', saved, typed)).not.toThrow();
    expect(readSketchDraft('source:a', saved)).toBeNull();
  });
});
