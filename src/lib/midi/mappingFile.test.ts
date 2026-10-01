import { describe, expect, it } from 'vitest';
import { mergeMappings, parseMappingFile, serializeMappingFile } from './mappingFile';
import type { MidiMapping } from './midiTypes';

let n = 0;
const makeId = () => `id-${++n}`;

const row = (over: Partial<MidiMapping> = {}): MidiMapping => ({
  id: 'x', channel: 0, type: 'cc', number: 1, path: 'vj:0:opacity',
  min: 0, max: 1, step: 0, mode: 'absolute', label: 'A L1 opacity', ...over,
});

describe('parseMappingFile', () => {
  it('reads the envelope format and keeps the controller name', () => {
    const text = JSON.stringify({ format: 'ghost-arcade-midi-mappings', version: 1, controller: 'QuNeo', mappings: [row()] });
    const parsed = parseMappingFile(text, makeId);
    expect(parsed.controller).toBe('QuNeo');
    expect(parsed.mappings).toEqual([row()]);
    expect(parsed.skipped).toEqual([]);
  });

  it('reads a bare array (raw localStorage shape)', () => {
    expect(parseMappingFile(JSON.stringify([row()]), makeId).mappings).toHaveLength(1);
  });

  it('fills missing id / label / mode, drops bad rows, reports why', () => {
    const text = JSON.stringify([
      { channel: 1, type: 'note', number: 36, path: 'vj:tap' },
      { channel: 0, type: 'cc', number: 200, path: 'vj:0:opacity' },
      { channel: 0, type: 'cc', number: 1 },
    ]);
    const parsed = parseMappingFile(text, makeId);
    expect(parsed.mappings).toHaveLength(1);
    expect(parsed.mappings[0]).toMatchObject({ id: expect.stringMatching(/^id-/), label: 'vj:tap', mode: 'absolute', min: 0, max: 1, step: 0 });
    expect(parsed.skipped).toHaveLength(2);
    expect(parsed.skipped[0]).toMatch(/0-127/);
    expect(parsed.skipped[1]).toMatch(/missing path/);
  });

  it('rejects documents that are not mappings', () => {
    expect(() => parseMappingFile('nope', makeId)).toThrow(/JSON/);
    expect(() => parseMappingFile('{"a":1}', makeId)).toThrow(/mappings/);
    expect(() => parseMappingFile(JSON.stringify({ format: 'other', mappings: [] }), makeId)).toThrow(/format/);
    expect(() => parseMappingFile(JSON.stringify({ format: 'ghost-arcade-midi-mappings', version: 99, mappings: [] }), makeId)).toThrow(/newer/);
    expect(() => parseMappingFile(JSON.stringify([{ path: 'x' }]), makeId)).toThrow(/No usable/);
  });

  it('round-trips through serializeMappingFile', () => {
    const text = serializeMappingFile([row(), row({ id: 'y', path: 'vj:1:opacity', number: 2 })], 'QuNeo');
    const parsed = parseMappingFile(text, makeId);
    expect(parsed.controller).toBe('QuNeo');
    expect(parsed.mappings.map(m => m.path)).toEqual(['vj:0:opacity', 'vj:1:opacity']);
  });
});

describe('mergeMappings', () => {
  it('replaces by path and keeps everything else', () => {
    const existing = [row({ id: 'old', number: 7 }), row({ id: 'keep', path: 'vj:stopall', type: 'note', number: 45 })];
    const merged = mergeMappings(existing, [row({ id: 'new', number: 1 })]);
    expect(merged.map(m => m.id)).toEqual(['keep', 'new']);
  });
});
