// Click-to-order for Screen FX chases: while recording, every layer the
// user selects (on the canvas or in the layer list) joins the effect's chase
// order, in click order. The order is written to the effect as it grows, so
// the chase follows it live; Done commits it as one undo step.

import { get, writable } from 'svelte/store';
import { project, selectedLayerId } from './layers';
import { recordDiscreteAction } from './historyHooks';
import { appendChaseOrder } from './stageEffects';

export interface ChaseOrderRecording {
  /** Mapping Screen FX (project.mappingComposition) or Stage FX (surface). */
  target: 'mapping' | 'surface';
  effectId: string;
  order: string[];
}

export type ChaseOrderWriter = (target: ChaseOrderRecording['target'], effectId: string, order: string[] | undefined) => void;

export const chaseOrderRecording = writable<ChaseOrderRecording | null>(null);


let stopListening: (() => void) | null = null;

export function startChaseOrderRecording(target: ChaseOrderRecording['target'], effectId: string, write: ChaseOrderWriter) {
  stopChaseOrderRecording(false);
  // The saved order is replaced from the first click on; finishing with no
  // clicks keeps it.
  chaseOrderRecording.set({ target, effectId, order: [] });
  // Start from no selection so the first click counts even on the layer
  // that happened to be selected.
  project.selectLayer(null);
  // The selection that is current now was not a click in the sequence.
  let primed = false;
  const unsub = selectedLayerId.subscribe((id) => {
    if (!primed) { primed = true; return; }
    const current = get(chaseOrderRecording);
    if (!current || !id) return;
    const order = appendChaseOrder(current.order, id);
    if (order.length === current.order.length) return;
    chaseOrderRecording.set({ ...current, order });
    write(current.target, current.effectId, order);
  });
  stopListening = unsub;
}

/** Finish recording. `commit` records the new order as an undo step. */
export function stopChaseOrderRecording(commit = true) {
  stopListening?.();
  stopListening = null;
  const current = get(chaseOrderRecording);
  if (!current) return;
  chaseOrderRecording.set(null);
  if (commit && current.order.length) recordDiscreteAction();
}
