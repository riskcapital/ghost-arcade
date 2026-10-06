import { readFileSync } from 'node:fs';
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

  it('imports a path validateControlPath does not recognise, but flags it', () => {
    // Dropping these would delete working mappings on a SAVE -> LOAD round-trip:
    // the validator rejects some paths midiRouter really does dispatch.
    const text = JSON.stringify([
      row(),
      row({ path: 'vj:0:blemd:next', number: 2 }),   // typo
      row({ path: 'vj:tempo:resync', number: 3 }),    // routes at midiRouter.ts:539
    ]);
    const parsed = parseMappingFile(text, makeId);
    expect(parsed.mappings.map(m => m.path)).toEqual(['vj:0:opacity', 'vj:0:blemd:next', 'vj:tempo:resync']);
    expect(parsed.skipped).toEqual([]);
    expect(parsed.unrecognizedPaths).toEqual(['vj:0:blemd:next', 'vj:tempo:resync']);
  });

  it('keeps a file of nothing but unrecognised paths, rather than rejecting it', () => {
    const parsed = parseMappingFile(JSON.stringify([row({ path: 'vj:0:blemd:next' })]), makeId);
    expect(parsed.mappings).toHaveLength(1);
    expect(parsed.unrecognizedPaths).toEqual(['vj:0:blemd:next']);
  });

  it('parses an empty mappings array as zero mappings rather than throwing', () => {
    // The caller must not go on to offer a Replace here — see MidiOverlay.
    const parsed = parseMappingFile(JSON.stringify({ format: 'ghost-arcade-midi-mappings', version: 1, mappings: [] }), makeId);
    expect(parsed.mappings).toEqual([]);
    expect(parsed.skipped).toEqual([]);
    expect(parseMappingFile('[]', makeId).mappings).toEqual([]);
  });

  it('imports every row of the shipped QuNeo presets with no skips', () => {
    for (const name of ['macros', 'perform'] as const) {
      const text = readFileSync(`docs/controllers/quneo/ghost-arcade-quneo-${name}-mappings.json`, 'utf8');
      const parsed = parseMappingFile(text, makeId);
      expect(parsed.skipped).toEqual([]);
      expect(parsed.unrecognizedPaths).toEqual([]);
      expect(parsed.mappings).toHaveLength(name === 'macros' ? 89 : 99);
    }
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
