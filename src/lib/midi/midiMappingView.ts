/**
 * Presentation helpers for the mappings table in Settings > MIDI.
 *
 * Two problems this solves, both of which are why the table could not just
 * render `midiStore.mappings` straight out.
 *
 * GROUPING. A mapping is stored per parameter: `addMapping` replaces any
 * existing mapping for the same `path`, so a parameter holds at most one.
 * A single pad or knob, though, can be bound to as many parameters as you
 * like — `getMappingsForMessage` returns an array for exactly that reason.
 * "Unlearn this pad" is therefore not one row, it is every row that shares a
 * (type, number, channel), which is what `groupMappingsByControl` builds.
 *
 * NAMING. `MidiMapping.label` comes from the `data-midi-label` attribute on
 * the control that was learned, and for an effect parameter that is just the
 * parameter's own name. Four mapped effects give four rows called "Intensity".
 * The path carries the context the label lacks, so `describeTarget` reads it
 * back out: `map:effect:<effectId>:<param>` resolves the instance id against
 * the open project and names the effect.
 *
 * That resolution can fail, and the failure is worth showing rather than
 * hiding. Mappings live in localStorage, so they are per machine and survive
 * project switches, while effect ids belong to a project. A mapping made
 * against an effect that has since been deleted, or that lives in a different
 * project, still fires and still occupies its control. The table is the only
 * place those become visible, so they are marked rather than dropped.
 */

import type { MidiMapping, MidiMessageType } from './midiTypes';
import type { Project } from '../types';
import { EFFECT_CATALOG } from '../effects/effectCatalog';

export interface MidiControlGroup {
  /** Stable key for an {#each} block. */
  key: string;
  channel: number;
  type: MidiMessageType;
  number: number;
  /** "Note 36", "CC 74", "Pitch bend" */
  controlLabel: string;
  /** "Ch 1", or "Any channel" for the -1 wildcard. */
  channelLabel: string;
  mappings: MidiMapping[];
}

export interface MidiTargetDescription {
  /** Where the parameter lives: "Kaleidoscope", "Layer 2", "VJ". */
  context: string | null;
  /** The parameter itself: "Intensity". */
  label: string;
  /** The path names an effect that is not in the open project. */
  orphaned: boolean;
}

/** Groups a control by what a message has to match to reach it. */
export function controlKey(m: Pick<MidiMapping, 'type' | 'number' | 'channel'>): string {
  return `${m.type}:${m.number}:${m.channel}`;
}

export function controlLabel(type: MidiMessageType, number: number): string {
  if (type === 'pitchbend') return 'Pitch bend';
  if (type === 'note') return `Note ${number}`;
  return `CC ${number}`;
}

/** Channel -1 is the "any channel" wildcard, not channel zero. */
export function channelLabel(channel: number): string {
  return channel === -1 ? 'Any channel' : `Ch ${channel + 1}`;
}

/**
 * One row per physical control, newest-looking order be damned: sort by
 * message type, then number, then channel, so the table reads the way a
 * controller is laid out rather than the order things happened to be
 * learned in.
 */
export function groupMappingsByControl(mappings: MidiMapping[]): MidiControlGroup[] {
  const groups = new Map<string, MidiControlGroup>();
  for (const m of mappings) {
    const key = controlKey(m);
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        channel: m.channel,
        type: m.type,
        number: m.number,
        controlLabel: controlLabel(m.type, m.number),
        channelLabel: channelLabel(m.channel),
        mappings: [],
      };
      groups.set(key, g);
    }
    g.mappings.push(m);
  }
  const typeOrder: Record<MidiMessageType, number> = { cc: 0, note: 1, pitchbend: 2 };
  return [...groups.values()].sort((a, b) =>
    typeOrder[a.type] - typeOrder[b.type] ||
    a.number - b.number ||
    a.channel - b.channel
  );
}

/** Does an incoming message reach this control? Mirrors getMappingsForMessage. */
export function groupMatchesMessage(
  group: MidiControlGroup,
  msg: { channel: number; type: MidiMessageType; number: number } | null,
): boolean {
  if (!msg) return false;
  return (
    group.type === msg.type &&
    group.number === msg.number &&
    (group.channel === -1 || group.channel === msg.channel)
  );
}

/** Effect instance id -> the catalog label for its type, plus its layer. */
function findEffect(project: Project | null, effectId: string): { name: string; where: string } | null {
  if (!project) return null;
  const nameFor = (type: string) =>
    EFFECT_CATALOG.find(e => e.type === type)?.label ?? type;

  for (const layer of project.layers ?? []) {
    const hit = (layer.effects ?? []).find(e => e.id === effectId);
    if (hit) return { name: nameFor(hit.type), where: layer.name };
  }
  const comp = project.mappingComposition?.effects ?? [];
  const compHit = comp.find(e => e.id === effectId);
  if (compHit) return { name: nameFor(compHit.type), where: 'Composition' };
  return null;
}

/** Edge effects have no type to name, so the layer is the useful context. */
function findEdgeEffect(project: Project | null, effectId: string): { where: string } | null {
  if (!project) return null;
  for (const layer of project.layers ?? []) {
    const hit = (layer.edgeEffects?.effects ?? []).find(e => e.id === effectId);
    if (hit) return { where: layer.name };
  }
  return null;
}

/** Prefixes that name themselves well enough without any lookup. */
const PREFIX_CONTEXT: Record<string, string> = {
  gpu: 'GPU layer',
  splat: 'Point cloud',
  model3d: '3D model',
  media: 'Media',
  layer: 'Layer',
  preset: 'Preset',
  shader: 'Shader',
  stage: 'Stage',
  svg: 'SVG',
  text: 'Text',
  lines: 'Lines',
  drawing: 'Drawing',
};

export function describeTarget(
  path: string,
  label: string,
  project: Project | null,
): MidiTargetDescription {
  const parts = (path || '').split(':');
  const fallbackLabel = label || parts[parts.length - 1] || path;

  if (parts[0] === 'map' && parts[1] === 'effect' && parts[2]) {
    const hit = findEffect(project, parts[2]);
    if (hit) return { context: `${hit.where} · ${hit.name}`, label: fallbackLabel, orphaned: false };
    return { context: 'Effect', label: fallbackLabel, orphaned: true };
  }

  if (parts[0] === 'map' && parts[1] === 'edge' && parts[2]) {
    const hit = findEdgeEffect(project, parts[2]);
    if (hit) return { context: `${hit.where} · Edge`, label: fallbackLabel, orphaned: false };
    return { context: 'Edge effect', label: fallbackLabel, orphaned: true };
  }

  if (parts[0] === 'map' && parts[1]) {
    return { context: PREFIX_CONTEXT[parts[1]] ?? 'Mapping', label: fallbackLabel, orphaned: false };
  }

  if (parts[0] === 'vj') return { context: 'VJ', label: fallbackLabel, orphaned: false };
  if (parts[0] === 'global') return { context: 'Global', label: fallbackLabel, orphaned: false };

  return { context: null, label: fallbackLabel, orphaned: false };
}
