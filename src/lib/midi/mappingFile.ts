// MIDI mapping file format — JSON import / export for the MIDI Edit bar.
//
// Envelope (what Save writes, and what controller presets ship as):
//   { "format": "ghost-arcade-midi-mappings", "version": 1,
//     "controller"?: string, "mappings": MidiMapping[] }
// A bare MidiMapping[] (the raw localStorage value) is accepted on Load too.
import { validateControlPath } from '../control/controlPaths';
import type { MidiMapping, MidiMappingMode, MidiMessageType } from './midiTypes';

export const MAPPING_FILE_FORMAT = 'ghost-arcade-midi-mappings';
export const MAPPING_FILE_VERSION = 1;

export interface MappingFile {
  format: typeof MAPPING_FILE_FORMAT;
  version: number;
  controller?: string;
  mappings: MidiMapping[];
}

const MESSAGE_TYPES: MidiMessageType[] = ['cc', 'note', 'pitchbend'];
const MODES: MidiMappingMode[] = ['absolute', 'toggle', 'relative'];

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}

/** Validate one raw mapping; returns null (with a reason) rather than throwing so a bad row can be reported by index. */
function coerceMapping(raw: unknown, index: number, makeId: () => string): { mapping: MidiMapping | null; reason?: string; unrecognizedPath?: string } {
  if (!raw || typeof raw !== 'object') return { mapping: null, reason: `row ${index}: not an object` };
  const r = raw as Record<string, unknown>;
  if (typeof r.path !== 'string' || !r.path.trim()) return { mapping: null, reason: `row ${index}: missing path` };
  // Flag — never drop — a path validateControlPath doesn't recognise. The validator
  // is not a complete model of what midiRouter dispatches (vj:tempo:resync routes at
  // midiRouter.ts:539 yet fails validation), so dropping would silently delete working
  // mappings on a SAVE -> LOAD round-trip. Store the raw trimmed path, not the
  // normalized one: midiRouter normalizes at dispatch, and the overlay matches
  // mappings against the raw path it learned.
  const unrecognizedPath = validateControlPath(r.path).valid ? undefined : r.path.trim();
  if (!MESSAGE_TYPES.includes(r.type as MidiMessageType)) return { mapping: null, reason: `row ${index} (${r.path}): type must be cc, note, or pitchbend` };
  if (!isInt(r.number) || r.number < 0 || r.number > 127) return { mapping: null, reason: `row ${index} (${r.path}): number must be 0-127` };
  if (!isInt(r.channel) || r.channel < -1 || r.channel > 15) return { mapping: null, reason: `row ${index} (${r.path}): channel must be 0-15 or -1` };

  const mode = MODES.includes(r.mode as MidiMappingMode) ? (r.mode as MidiMappingMode) : 'absolute';
  const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  const discrete = Array.isArray(r.discreteValues) && r.discreteValues.every(v => typeof v === 'string')
    ? (r.discreteValues as string[])
    : undefined;

  return {
    unrecognizedPath,
    mapping: {
      id: typeof r.id === 'string' && r.id ? r.id : makeId(),
      channel: r.channel,
      type: r.type as MidiMessageType,
      number: r.number,
      path: r.path.trim(),
      min: num(r.min, 0),
      max: num(r.max, 1),
      step: num(r.step, 0),
      mode,
      label: typeof r.label === 'string' && r.label ? r.label : r.path.trim(),
      ...(discrete ? { discreteValues: discrete } : {}),
    },
  };
}

export interface ParsedMappingFile {
  mappings: MidiMapping[];
  controller?: string;
  skipped: string[]; // reasons for rows that were dropped
  /** Imported, but validateControlPath didn't recognise the path — may not fire. */
  unrecognizedPaths: string[];
}

/** Parse Load input. Throws only when the document as a whole is unusable. */
export function parseMappingFile(text: string, makeId: () => string): ParsedMappingFile {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new Error('Not valid JSON');
  }

  let rows: unknown[];
  let controller: string | undefined;
  if (Array.isArray(doc)) {
    rows = doc;
  } else if (doc && typeof doc === 'object' && Array.isArray((doc as MappingFile).mappings)) {
    const env = doc as MappingFile;
    if (env.format && env.format !== MAPPING_FILE_FORMAT) throw new Error(`Unknown format "${env.format}"`);
    if (typeof env.version === 'number' && env.version > MAPPING_FILE_VERSION) {
      throw new Error(`Mapping file version ${env.version} is newer than this build supports (${MAPPING_FILE_VERSION})`);
    }
    rows = env.mappings;
    controller = typeof env.controller === 'string' ? env.controller : undefined;
  } else {
    throw new Error('Expected a mappings array or a { "mappings": [...] } file');
  }

  const mappings: MidiMapping[] = [];
  const skipped: string[] = [];
  const unrecognizedPaths: string[] = [];
  rows.forEach((row, i) => {
    const { mapping, reason, unrecognizedPath } = coerceMapping(row, i, makeId);
    if (mapping) mappings.push(mapping);
    else if (reason) skipped.push(reason);
    if (unrecognizedPath) unrecognizedPaths.push(unrecognizedPath);
  });
  if (!mappings.length && rows.length) throw new Error(`No usable mappings (${skipped[0]})`);
  return { mappings, controller, skipped, unrecognizedPaths };
}

export function serializeMappingFile(mappings: MidiMapping[], controller?: string): string {
  const file: MappingFile = {
    format: MAPPING_FILE_FORMAT,
    version: MAPPING_FILE_VERSION,
    ...(controller ? { controller } : {}),
    mappings,
  };
  return JSON.stringify(file, null, 2);
}

/**
 * Merge: incoming rows replace existing rows on the same path (one control
 * per path, same rule as MIDI learn); everything else the user mapped is kept.
 */
export function mergeMappings(existing: MidiMapping[], incoming: MidiMapping[]): MidiMapping[] {
  const paths = new Set(incoming.map(m => m.path));
  return [...existing.filter(m => !paths.has(m.path)), ...incoming];
}
