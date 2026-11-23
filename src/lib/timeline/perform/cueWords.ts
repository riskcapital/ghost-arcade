/**
 * What a step does, in words, for the Perform list's "Then" column: a
 * section's end action, or a cue's actions ("Screen FX Strobe, Blackout").
 * Pure; the names of presets and layers come in through `names`.
 *
 * @ui-text: the extractor reads every string here (they are shown).
 */
import type { Cue, CueAction } from '../../show/cueList';
import { SECTION_ACTION_LABELS, type TimelineSection } from '../sections/sectionModel';

export interface CueNames {
  composition?: (id: string) => string | undefined;
  layer?: (id: string) => string | undefined;
}

export function actionWords(a: CueAction, names: CueNames = {}): string {
  switch (a.kind) {
    case 'preset': return `Mapping preset · ${names.composition?.(a.compositionId) ?? 'missing'}`;
    case 'snapshot': return `Snapshot ${a.slot}`;
    case 'vjClip': return `VJ clip ${a.deck}${a.layer + 1}·${a.column + 1}`;
    case 'vjColumn': return `VJ column ${a.column + 1}`;
    case 'vjStopAll': return 'Stop all VJ clips';
    case 'blackout': return a.on ? 'Blackout' : 'Lights back';
    case 'macro': return `Macro ${a.macro}`;
    case 'layerOpacity': return `${names.layer?.(a.layerId) ?? 'Layer'} opacity`;
    case 'param': return `Set ${a.path}`;
    case 'timeline': return `Timeline ${a.op}`;
    case 'projector': return `Projector ${a.command}`;
    case 'takeover': return 'Take a row over';
    case 'takeoverRelease': return 'Return a row';
  }
}

export function cueWords(cue: Cue | null, names: CueNames = {}): string {
  if (!cue) return 'No cue';
  if (!cue.actions.length) return 'Moves the list along';
  return cue.actions.map((a) => actionWords(a, names)).join(', ');
}

/** A section's "Then": its end action in words (Play through, Loop until GO · pass 2…). */
export function sectionWords(s: TimelineSection, sections: readonly TimelineSection[], passes = 0, looping = false): string {
  if (s.action === 'jump') {
    const to = sections.find((x) => x.id === s.jumpTo)?.name ?? '…';
    return (s.passes ?? 1) > 1 ? `Jump to ${to} after ${s.passes} passes` : `Jump to ${to}`;
  }
  const base = SECTION_ACTION_LABELS[s.action];
  return looping && s.action === 'vamp' ? `${base} · pass ${passes + 1}` : base;
}
