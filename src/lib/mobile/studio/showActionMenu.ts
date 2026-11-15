/**
 * The show actions a paired phone's trigger zone may add, from the desktop.
 *
 * A desktop that can (`studio_capabilities.showActions`) sends its picker's
 * kinds and labels, in its own order, and the Looks, presets and Timeline
 * sections there are now. The phone builds actions of the desktop's schema
 * (`show/showActionTypes.ts`) from them; the desktop checks every scene and
 * fires them when the zone does. Without the flag the phone adds none (it
 * keeps and lists the ones a scene already has), as before.
 */
import type { ShowAction, ShowActionKind } from '../../show/showActionTypes';
import { validateShowAction } from '../../show/showActionValidate';

export type ShowName = { id: string; name: string };
export type ShowActionMenu = { kinds: { kind: ShowActionKind; label: string }[]; looks: ShowName[]; presets: ShowName[]; sections: ShowName[] };

/** The kinds this phone can build. Takeover and release name Timeline rows and stay on the desktop, as there. */
export const PHONE_SHOW_KINDS: readonly ShowActionKind[] = ['look', 'preset', 'clip', 'clipColumn', 'section', 'go', 'cue', 'phrase', 'liveClip', 'liveScene', 'blackout', 'transport'];
const ID = /^[\w.:-]{1,100}$/;
const LIST_MAX = 200;

function names(raw: unknown): ShowName[] {
  if (!Array.isArray(raw)) return [];
  const out: ShowName[] = [];
  for (const x of raw.slice(0, LIST_MAX)) {
    const v = x as { id?: unknown; name?: unknown } | null;
    if (!v || typeof v.id !== 'string' || !ID.test(v.id)) continue;
    out.push({ id: v.id, name: typeof v.name === 'string' && v.name.trim() ? v.name.trim().slice(0, 60) : v.id });
  }
  return out;
}

/** The menu from `studio_capabilities.showActions`, or null when the desktop sends none (or one this phone cannot read). */
export function readShowActionMenu(raw: unknown): ShowActionMenu | null {
  const m = raw as { version?: unknown; kinds?: unknown } | null | undefined;
  if (!m || typeof m !== 'object' || m.version !== 1 || !Array.isArray(m.kinds)) return null;
  const kinds: ShowActionMenu['kinds'] = [];
  for (const k of m.kinds as unknown[]) {
    const v = k as { kind?: unknown; label?: unknown } | null;
    if (!v || !PHONE_SHOW_KINDS.includes(v.kind as ShowActionKind) || kinds.some((x) => x.kind === v.kind)) continue;
    kinds.push({ kind: v.kind as ShowActionKind, label: typeof v.label === 'string' && v.label.trim() ? v.label.trim().slice(0, 40) : String(v.kind) });
  }
  if (!kinds.length) return null;
  const r = raw as Record<string, unknown>;
  return { kinds, looks: names(r.looks), presets: names(r.presets), sections: names(r.sections) };
}

/** A ready action of a kind, as the desktop picker starts one; null while it needs a choice there is none of (no presets). */
export function startShowAction(kind: ShowActionKind, menu: ShowActionMenu): ShowAction | null {
  switch (kind) {
    case 'look': return menu.looks[0] ? { kind: 'look', lookId: menu.looks[0].id } : null;
    case 'preset': return menu.presets[0] ? { kind: 'preset', compositionId: menu.presets[0].id } : null;
    case 'clip': return { kind: 'clip', deck: 'A', row: 0, column: 0 };
    case 'clipColumn': return { kind: 'clipColumn', deck: 'A', column: 0 };
    case 'section': return menu.sections[0] ? { kind: 'section', id: menu.sections[0].id } : { kind: 'section', index: 0 };
    case 'go': return { kind: 'go' };
    case 'cue': return { kind: 'cue', op: 'go' };
    case 'phrase': return { kind: 'phrase', pad: 1 };
    case 'liveClip': return { kind: 'liveClip', track: 0, slot: 0 };
    case 'liveScene': return { kind: 'liveScene', scene: 0 };
    case 'blackout': return { kind: 'blackout' };
    case 'transport': return { kind: 'transport', op: 'toggle' };
    default: return null;
  }
}

/** The action with one field changed, or null when the change makes it invalid (the desktop's own check). */
export function editShowAction(action: ShowAction, patch: Record<string, unknown>): ShowAction | null {
  return validateShowAction({ ...action, ...patch });
}

/** A 1-based number typed on the phone to the action's 0-based index, kept in range. */
export const fromOne = (value: string | number, max = 255): number => Math.max(0, Math.min(max, Math.round(Number(value) || 1) - 1));

/** One short line for an action, with the desktop's names where the menu has them. Numbers count from 1. */
export function describeShowAction(a: ShowAction, menu: ShowActionMenu | null): string {
  const find = (list: ShowName[] | undefined, id: string) => list?.find((x) => x.id === id)?.name;
  switch (a.kind) {
    case 'look': return `Look · ${find(menu?.looks, a.lookId) ?? 'set on the desktop'}`;
    case 'preset': return `Preset · ${find(menu?.presets, a.compositionId) ?? (menu ? 'missing preset' : 'set on the desktop')}`;
    case 'clip': return `VJ clip · ${a.deck ?? 'A'} row ${a.row + 1}, column ${a.column + 1}`;
    case 'clipColumn': return `VJ column · ${a.deck ?? 'A'} column ${a.column + 1}`;
    case 'liveClip': return `Live clip · track ${a.track + 1}, slot ${a.slot + 1}`;
    case 'liveScene': return `Live scene · ${a.scene + 1}`;
    case 'section': {
      const name = a.id ? find(menu?.sections, a.id) : a.name;
      return `Section · ${name ?? (a.index !== undefined ? `number ${a.index + 1}` : 'on the desktop')}`;
    }
    case 'go': return 'GO';
    case 'transport': return `Transport · ${a.op === 'seek' ? `go to ${a.seconds ?? 0} s` : a.op}`;
    case 'phrase': return a.stop ? 'Phrases · stop' : `Phrase · pad ${a.pad ?? 1}`;
    case 'blackout': return `Blackout · ${a.on === undefined ? 'toggle' : a.on ? 'on' : 'off'}`;
    case 'cue': return a.op === 'fire' ? `Cue · ${(a.index ?? 0) + 1}` : `Cue list · ${a.op}`;
    case 'takeover': return 'Takeover';
    case 'release': return 'Release';
  }
}
