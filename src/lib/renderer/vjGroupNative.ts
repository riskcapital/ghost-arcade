import { buildVJMixGraph, type VJMixGraphOptions, type VJMixRow } from './vjMixNative';
import { buildNativeEffectPassChainGraph, nativeEffectPassManifestEntry, type NativeEffectPassChainPass } from './nativeEffectPass';
import { NATIVE_EFFECT_PASS_LIMIT } from './nativeEffectChainPolicy';

export function vjGroupSourceId(mixSourceId: string, groupId: string): string {
  return `${mixSourceId}:group:${encodeURIComponent(groupId)}`;
}

export interface VJGroupGraphOptions extends VJMixGraphOptions {
  effects: NativeEffectPassChainPass[];
  /** Applied by the parent mix after all children and group effects. */
  opacity: number;
  blendMode: string;
}

/**
 * A group is a reusable full-frame source. Child level/blend happens inside
 * this graph; group level/blend belongs exclusively to the parent mix row.
 * Combining the passes in one job keeps child composition before group FX.
 */
export function buildVJGroupGraph(options: VJGroupGraphOptions) {
  if (!options.outputSourceId || !options.rows.length) throw new Error('A VJ group requires an output and at least one child');
  if (options.effects.length > NATIVE_EFFECT_PASS_LIMIT) throw new Error(`A VJ group supports at most ${NATIVE_EFFECT_PASS_LIMIT} effects`);
  if (!Number.isFinite(options.opacity)) throw new Error('Group opacity must be finite');
  for (const effect of options.effects) nativeEffectPassManifestEntry(effect.effect);
  const mixSourceId = options.effects.length ? `${options.outputSourceId}:children` : options.outputSourceId;
  const reserved = new Set([options.outputSourceId, mixSourceId, `${mixSourceId}:step:0`, `${mixSourceId}:step:1`]);
  if (options.rows.some(row => reserved.has(row.frameId))) throw new Error('A VJ group cannot sample its own output');
  const mix = buildVJMixGraph({ ...options, outputSourceId: mixSourceId });
  const config: {
    buffers: Array<Record<string, unknown>>;
    passes: unknown[];
    render_passes: Array<Record<string, unknown>>;
    readbacks: string[];
  } = { buffers: [...mix.config.buffers], passes: [], render_passes: [...mix.config.render_passes], readbacks: [] };
  if (options.effects.length) {
    const fx = buildNativeEffectPassChainGraph({
      sourceId: mixSourceId, targetSourceId: options.outputSourceId,
      effects: options.effects, width: options.width, height: options.height,
      time: options.time, frameIndex: options.frameIndex,
    });
    config.buffers.push(...fx.config.buffers);
    config.render_passes.push(...fx.config.render_passes);
  }
  // Effect builders have their own sequence conventions. Assign one strictly
  // increasing sequence across the combined graph to preserve dependencies.
  config.render_passes = config.render_passes.map((pass, index) => ({
    ...pass, name: `vj-group:${options.outputSourceId}:${index}`, seq: options.frameIndex * 64 + index,
  }));
  const row: VJMixRow = {
    frameId: options.outputSourceId,
    opacity: Math.max(0, Math.min(1, options.opacity)),
    blendMode: options.blendMode,
  };
  return { config, row };
}

export interface VJGroupedMixOptions extends VJMixGraphOptions {
  rows: Array<VJMixRow & { groupId?: string }>;
  groups: Array<{ id: string; opacity: number; blendMode: string; effects: NativeEffectPassChainPass[] }>;
}
/** One job for all group dependencies followed by the parent mix. */
export function buildVJGroupedMixGraph(options: VJGroupedMixOptions) {
  const groups = new Map(options.groups.map(g => [g.id, g]));
  const config = { buffers: [] as Record<string, unknown>[], passes: [] as unknown[], render_passes: [] as Record<string, unknown>[], readbacks: [] as string[] };
  const parent: VJMixRow[] = [];
  const emitted = new Set<string>();
  for (let index = 0; index < options.rows.length;) {
    const row = options.rows[index];
    const group = row.groupId ? groups.get(row.groupId) : undefined;
    if (!group) { parent.push(row); index++; continue; }
    if (emitted.has(group.id)) throw new Error('Group members must occupy a contiguous stack range');
    emitted.add(group.id);
    const children: VJMixRow[] = [];
    while (index < options.rows.length && options.rows[index].groupId === group.id) children.push(options.rows[index++]);
    const graph = buildVJGroupGraph({ ...options, ...group, rows: children, outputSourceId: vjGroupSourceId(options.outputSourceId, group.id) });
    config.buffers.push(...graph.config.buffers);
    config.render_passes.push(...graph.config.render_passes);
    parent.push(graph.row);
  }
  const mix = buildVJMixGraph({ ...options, rows: parent });
  config.buffers.push(...mix.config.buffers);
  config.render_passes.push(...mix.config.render_passes);
  config.render_passes = config.render_passes.map((pass, index) => ({ ...pass, seq: options.frameIndex * 128 + index }));
  return { config };
}
