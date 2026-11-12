/**
 * Names for show actions in pickers and lists: what kinds there are, and a
 * short line for one action ("Look · Neon edges", "VJ clip · A row 2, col 3").
 */
import type { ShowAction, ShowActionKind } from './showActions';
import { edgeLook } from '../looks/edgeLookCatalog';

/** The kinds a picker offers, in menu order. Takeover and release name rows
 *  of one Timeline and are left to the Timeline itself. */
export const PICKABLE_SHOW_ACTIONS: { kind: ShowActionKind; label: string }[] = [
  { kind: 'look', label: 'Apply a Look' },
  { kind: 'preset', label: 'Recall a preset' },
  { kind: 'clip', label: 'Launch a VJ clip' },
  { kind: 'clipColumn', label: 'Launch a VJ column' },
  { kind: 'section', label: 'Jump to a section' },
  { kind: 'go', label: 'GO' },
  { kind: 'cue', label: 'Cue list' },
  { kind: 'phrase', label: 'Launch a phrase' },
  { kind: 'liveClip', label: 'Fire a Live clip' },
  { kind: 'liveScene', label: 'Fire a Live scene' },
  { kind: 'blackout', label: 'Blackout' },
  { kind: 'transport', label: 'Timeline transport' },
];

/** A ready-to-use action of each kind, for when the kind is first picked. */
export function defaultShowAction(kind: ShowActionKind, firstLookId = 'neon-edges'): ShowAction | null {
  switch (kind) {
    case 'look': return { kind: 'look', lookId: firstLookId };
    case 'preset': return null;
    case 'clip': return { kind: 'clip', deck: 'A', row: 0, column: 0 };
    case 'clipColumn': return { kind: 'clipColumn', deck: 'A', column: 0 };
    case 'section': return { kind: 'section', index: 0 };
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

type Names = { preset?: (id: string) => string | undefined; section?: (id: string) => string | undefined };

/** One short line for an action. Numbers count from 1, as the app shows them. */
export function describeShowAction(action: ShowAction, names: Names = {}): string {
  switch (action.kind) {
    case 'look': return `Look · ${edgeLook(action.lookId)?.name ?? action.lookId}`;
    case 'preset': return `Preset · ${names.preset?.(action.compositionId) ?? 'missing preset'}`;
    case 'clip': return `VJ clip · ${action.deck ?? 'A'} row ${action.row + 1}, column ${action.column + 1}`;
    case 'clipColumn': return `VJ column · ${action.deck ?? 'A'} column ${action.column + 1}`;
    case 'liveClip': return `Live clip · track ${action.track + 1}, slot ${action.slot + 1}`;
    case 'liveScene': return `Live scene · ${action.scene + 1}`;
    case 'section': {
      const name = action.id ? names.section?.(action.id) : action.name;
      return `Section · ${name ?? (action.index !== undefined ? `number ${action.index + 1}` : 'missing section')}`;
    }
    case 'go': return 'GO';
    case 'transport': return `Transport · ${action.op === 'seek' ? `go to ${action.seconds ?? 0} s` : action.op}`;
    case 'phrase': return action.stop ? 'Phrases · stop' : `Phrase · pad ${action.pad ?? 1}`;
    case 'blackout': return `Blackout · ${action.on === undefined ? 'toggle' : action.on ? 'on' : 'off'}`;
    case 'cue': return action.op === 'fire' ? `Cue · ${(action.index ?? 0) + 1}` : `Cue list · ${action.op}`;
    case 'takeover': return 'Takeover';
    case 'release': return 'Release';
  }
}
