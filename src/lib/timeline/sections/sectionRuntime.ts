/**
 * The live side of the Timeline's sections, installed with show control:
 *
 * - a Live section hands its pieces (or every piece) to the VJ decks through
 *   the takeover while the playhead is in it, and gives them back (with the
 *   takeover's own release) at GO or when the playhead leaves;
 * - GO from MIDI / OSC / keys (`show:go`) goes to the Timeline's sections
 *   when the Timeline is the active document and has sections, and to the
 *   cue list otherwise.
 */
import { get } from 'svelte/store';
import { setShowSectionEffects, showTimeline } from '../../stores/showTimeline';
import { liveTakeover, type TakeoverSource } from '../../show/takeover/liveTakeover';
import { runAsLiveControl } from '../../stores/historyHooks';
import type { SectionLiveSource, TimelineSection } from './sectionModel';
import type { SectionEvent } from './sectionPlayer';

/** Pieces each Live section took over (layer ids). */
const engaged = new Map<string, string[]>();

export function liveTakeoverSource(source: SectionLiveSource | undefined): TakeoverSource {
  if (!source) return { kind: 'vjMix' };
  switch (source.kind) {
    case 'vjRow': return { kind: 'vjRow', deck: source.deck, row: source.row };
    case 'vjGroup': return { kind: 'vjGroup', groupId: source.groupId, ...(source.name ? { name: source.name } : {}) };
    case 'black': return { kind: 'black' };
    default: return { kind: 'vjMix' };
  }
}

/** The rows a Live section hands over: every piece's row, or the ones it names. */
export function livePieceRows(section: Pick<TimelineSection, 'livePieces'>): Array<{ id: string; layerId: string }> {
  const rows = get(showTimeline).layerTracks.filter((t) => !t.subRow);
  const pieces = section.livePieces;
  if (!pieces || pieces === 'all') return rows.map((t) => ({ id: t.id, layerId: t.layerId }));
  const want = new Set(pieces);
  return rows.filter((t) => want.has(t.layerId)).map((t) => ({ id: t.id, layerId: t.layerId }));
}

export function handleSectionEvent(e: SectionEvent): void {
  if (e.type === 'liveStart') {
    const rows = livePieceRows(e.section);
    const source = liveTakeoverSource(e.section.liveSource);
    const ids: string[] = [];
    runAsLiveControl(() => {
      for (const r of rows) {
        if (liveTakeover.engage(r.layerId, source, { trackId: r.id, fadeIn: 0.5 })) ids.push(r.layerId);
      }
    });
    engaged.set(e.section.id, ids);
  } else if (e.type === 'liveEnd') {
    const ids = engaged.get(e.section.id) ?? [];
    engaged.delete(e.section.id);
    runAsLiveControl(() => {
      for (const id of ids) liveTakeover.release(id);
    });
  }
}

/** GO goes to the Timeline's sections now (else the cue list). */
export function timelineTakesGo(): boolean {
  const s = get(showTimeline);
  return s.doc === 'timeline' && s.sections.length > 0;
}

export function installSectionRuntime(): () => void {
  setShowSectionEffects(handleSectionEvent);
  // Debug/automation surface (Show Runner), like window.__ghostArcade's others.
  try {
    const w = window as unknown as { __ghostArcade?: Record<string, unknown> };
    w.__ghostArcade = {
      ...(w.__ghostArcade ?? {}),
      timelineScore: {
        /** Score the song as the dialog's confirm does; returns what it added. */
        async score() {
          const { prepareScore, commitScore } = await import('../score/scoreRuntime');
          const r = await prepareScore();
          if (!r.ok) return { ok: false, reason: r.reason };
          commitScore(r.prep);
          return { ok: true, adds: r.prep.draft.adds, plan: r.prep.draft.plan.map((p) => ({ name: p.name, kind: p.kind, start: p.start, end: p.end, looks: p.lookIds })) };
        },
        async shuffle() {
          const { shuffleScore } = await import('../score/scoreRuntime');
          const r = await shuffleScore();
          return r.ok ? { ok: true } : { ok: false, reason: r.reason };
        },
      },
    };
  } catch { /* sealed */ }
  return () => {
    setShowSectionEffects(null);
    for (const ids of engaged.values()) for (const id of ids) liveTakeover.release(id);
    engaged.clear();
  };
}
