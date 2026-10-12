/** Stable effect identities prevent macro routes from following selection changes. */
export type MacroTarget =
  | { scope: 'mapping-layer'; layerId: string; effectId: string; param: string }
  | { scope: 'mapping-composition' | 'vj-composition'; effectId: string; param: string }
  | { scope: 'vj-layer'; bank: 'A' | 'B'; effectId: string; param: string }
  | { scope: 'vj-clip'; bank: 'A' | 'B'; clipId: string; effectId: string; param: string };
export interface MacroAssignment {
  target: MacroTarget;
  label: string;
  min: number;
  max: number;
  from: number;
  to: number;
}
export function macroTargetKey(t: MacroTarget): string {
  return JSON.stringify([t.scope, 'bank' in t ? t.bank : '', 'layerId' in t ? t.layerId : '', 'clipId' in t ? t.clipId : '', t.effectId, t.param]);
}
export function normalizeMacroAssignment(input: unknown): MacroAssignment | null {
  const a = input as MacroAssignment | null;
  if (!a || typeof a !== 'object' || !a.target || typeof a.target !== 'object') return null;
  const t = a.target;
  if (!['mapping-layer', 'mapping-composition', 'vj-composition', 'vj-layer', 'vj-clip'].includes(t.scope)) return null;
  if (!t.effectId || typeof t.effectId !== 'string' || !t.param || typeof t.param !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(t.param)) return null;
  if (t.scope === 'mapping-layer' && (typeof t.layerId !== 'string' || !t.layerId)) return null;
  if ((t.scope === 'vj-layer' || t.scope === 'vj-clip') && t.bank !== 'A' && t.bank !== 'B') return null;
  if (t.scope === 'vj-clip' && (typeof t.clipId !== 'string' || !t.clipId)) return null;
  if (![a.min, a.max, a.from, a.to].every(Number.isFinite) || a.min >= a.max) return null;
  return { target: { ...t }, label: typeof a.label === 'string' ? a.label.slice(0, 160) : t.param,
    min: a.min, max: a.max, from: Math.max(a.min, Math.min(a.max, a.from)), to: Math.max(a.min, Math.min(a.max, a.to)) };
}
export function macroAssignmentValue(a: MacroAssignment, value: number): number {
  const v = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  return a.from * (1 - v) + a.to * v;
}
let writer: ((target: MacroTarget, value: number) => void) | undefined;
export function registerMacroAssignmentWriter(next: typeof writer) { writer = next; }
export function applyMacroAssignments(assignments: readonly MacroAssignment[], value: number) {
  for (const assignment of assignments) writer?.(assignment.target, macroAssignmentValue(assignment, value));
}

/** Read-only lookup shared by assignment status UI; inactive blocks count as available. */
export function findMacroTargetEffect(
  target: MacroTarget,
  project: import('../types').Project,
  launcher: import('./vjClipLauncher').VJClipLauncherState,
): import('../types').Effect | undefined {
  const find = (effects: import('../types').Effect[] | undefined) => effects?.find(effect => effect.id === target.effectId);
  if (target.scope === 'mapping-layer') return find(project.layers.find(layer => layer.id === target.layerId)?.effects);
  if (target.scope === 'mapping-composition') return find(project.mappingComposition?.effects);
  if (target.scope === 'vj-composition') return find(launcher.compositionEffects);
  if (target.scope === 'vj-layer') {
    const rows = target.bank === 'B' ? launcher.bankBLayerStates : launcher.layerStates;
    return rows.map(row => find(row.effects)).find(Boolean);
  }
  if (target.scope !== 'vj-clip') return undefined;
  const rows = target.bank === 'B' ? launcher.bankBLayerStates : launcher.layerStates;
  for (const row of rows) {
    if (row.activeClip?.id === target.clipId) {
      const effect = find(row.activeClip.effects);
      if (effect) return effect;
    }
  }
  const grids = [target.bank === 'B' ? launcher.bankBClipGrid : launcher.clipGrid,
    ...launcher.blocks.map(block => target.bank === 'B' ? block.bankBClipGrid : block.clipGrid)];
  for (const grid of grids) for (const row of grid ?? []) for (const clip of row) {
    if (clip?.id === target.clipId) {
      const effect = find(clip.effects);
      if (effect) return effect;
    }
  }
  return undefined;
}
