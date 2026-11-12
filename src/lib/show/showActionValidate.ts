/**
 * Check a stored show action (from a project, a scene file, a phone) and
 * return a clean copy built only from the fields `ShowAction` knows, or null.
 * Kept apart from `showActions.ts` so models that store actions (interactive
 * zones) can validate them without pulling in the app's stores.
 */
import type { ShowAction } from './showActions';

const ID = /^[\w.:-]{1,100}$/;
const text = (v: unknown, max = 100): string | null =>
  typeof v === 'string' && v.length > 0 && v.length <= max ? v : null;
const index = (v: unknown, max = 10000): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max ? v : null;
const deck = (v: unknown): 'A' | 'B' | undefined => (v === 'A' || v === 'B' ? v : undefined);

export function validateShowAction(raw: unknown): ShowAction | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  switch (a.kind) {
    case 'look': {
      const lookId = text(a.lookId);
      if (!lookId || !ID.test(lookId)) return null;
      const paletteId = text(a.paletteId);
      const layerIds = Array.isArray(a.layerIds)
        ? a.layerIds.filter((id): id is string => typeof id === 'string' && ID.test(id)).slice(0, 256)
        : undefined;
      return {
        kind: 'look',
        lookId,
        ...(paletteId && ID.test(paletteId) ? { paletteId } : {}),
        ...(layerIds?.length ? { layerIds } : {}),
      };
    }
    case 'preset': {
      const compositionId = text(a.compositionId);
      return compositionId && ID.test(compositionId) ? { kind: 'preset', compositionId } : null;
    }
    case 'clip': {
      const row = index(a.row, 255), column = index(a.column, 255);
      if (row === null || column === null) return null;
      const d = deck(a.deck);
      return { kind: 'clip', row, column, ...(d ? { deck: d } : {}) };
    }
    case 'clipColumn': {
      const column = index(a.column, 255);
      if (column === null) return null;
      const d = deck(a.deck);
      return { kind: 'clipColumn', column, ...(d ? { deck: d } : {}) };
    }
    case 'liveClip': {
      const track = index(a.track, 999), slot = index(a.slot, 999);
      return track === null || slot === null ? null : { kind: 'liveClip', track, slot };
    }
    case 'liveScene': {
      const scene = index(a.scene, 999);
      return scene === null ? null : { kind: 'liveScene', scene };
    }
    case 'section': {
      const id = text(a.id), name = text(a.name), i = index(a.index, 999);
      if (!id && !name && i === null) return null;
      return {
        kind: 'section',
        ...(id && ID.test(id) ? { id } : {}),
        ...(name ? { name } : {}),
        ...(i !== null ? { index: i } : {}),
      };
    }
    case 'go':
      return { kind: 'go' };
    case 'phrase': {
      if (a.stop === true) return { kind: 'phrase', stop: true };
      const pad = index(a.pad, 64);
      return pad !== null && pad >= 1 ? { kind: 'phrase', pad } : null;
    }
    case 'blackout':
      return typeof a.on === 'boolean' ? { kind: 'blackout', on: a.on } : { kind: 'blackout' };
    case 'cue': {
      const op = a.op;
      if (op === 'fire') {
        const i = index(a.index, 9999);
        return i === null ? null : { kind: 'cue', op: 'fire', index: i };
      }
      return op === 'go' || op === 'back' || op === 'stop' || op === 'reset' ? { kind: 'cue', op } : null;
    }
    case 'transport': {
      const op = a.op;
      if (op === 'seek') {
        const seconds = typeof a.seconds === 'number' && Number.isFinite(a.seconds) ? Math.max(0, a.seconds) : null;
        return seconds === null ? null : { kind: 'transport', op, seconds };
      }
      return op === 'play' || op === 'pause' || op === 'stop' || op === 'toggle' ? { kind: 'transport', op } : null;
    }
    default:
      // Takeover and release name rows of one Timeline; they do not travel
      // with a scene.
      return null;
  }
}
