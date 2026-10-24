import { createLayer, type Layer, type Effect } from '../types';
import type { VJGroup } from '../stores/vjGroups';

function parseRow(id: string) {
  const match = /^vj-layer-(\d+)(?:-([AB]))?$/.exec(id);
  return match ? { idx: Number(match[1]) } : null;
}

/** Build the full post-crossfade mix, including composition FX, for display and stage feeds. */
export function appendNativeVjMixCarrier(list: Layer[], groups: VJGroup[], compositionEffects: Effect[]): Layer[] {
  type MixRowEntry = { layerId: string; opacity: number; blendMode: string };
  const rowsByIdx = new Map<number, MixRowEntry>();
  for (const layer of list) {
    const id = String(layer.id);
    const xfade = /^vj-xfade-(\d+)$/.exec(id);
    if (xfade) {
      // Crossfade carrier: bank opacities are baked into the native
      // transition pass output, so the row rides at full opacity.
      rowsByIdx.set(Number(xfade[1]), {
        layerId: id,
        opacity: 1,
        blendMode: String(layer.blendMode || 'normal'),
      });
      continue;
    }
    const parsed = parseRow(id);
    if (!parsed) continue;
    const existing = rowsByIdx.get(parsed.idx);
    // A crossfade carrier always wins; among plain/bank rows keep the
    // most visible entry (dual-bank residents ride at opacity 0).
    if (existing?.layerId.startsWith('vj-xfade-')) continue;
    const entry: MixRowEntry = {
      layerId: id,
      opacity: Math.max(0, Math.min(1, layer.opacity ?? 1)),
      blendMode: String(layer.blendMode || 'normal'),
    };
    if (!existing || entry.opacity >= existing.opacity) rowsByIdx.set(parsed.idx, entry);
  }
  if (!rowsByIdx.size) return list;
  // Bottom→top: VJ row 0 is topmost (the engine reverses the render
  // plan), so the composite stacks from the highest index upward.
  const rows = Array.from(rowsByIdx.entries())
    .sort((a, b) => b[0] - a[0])
    .flatMap(([index, entry]) => {
      const groupId = groups.find(g => index >= g.first && index <= g.last)?.id;
      // Performer worlds are additive overlays on their assigned row. They
      // must enter the mix before all feed layers are hidden below; otherwise
      // they remain resident but are never presented in Mix or Stage output.
      const worlds = list.filter(layer => {
        const match = /^performer-world-[AB]-(\d+)$/.exec(String(layer.id));
        return match && Number(match[1]) === index && layer.visible !== false;
      }).map(layer => ({
        layerId: layer.id,
        opacity: Math.max(0, Math.min(1, layer.opacity ?? 1)),
        blendMode: String(layer.blendMode || 'add'),
        groupId,
      }));
      return [{ ...entry, groupId }, ...worlds];
    });
  return [
    ...list.map(layer => ({ ...layer, opacity: 0 })),
    {
      ...createLayer('__vj-mix__', 'VJ Mix', 'media'),
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      source: {
        id: '__vj-mix-src__',
        type: 'effect',
        src: 'plugin://vj-mix',
        name: 'VJ Mix',
        effectSource: {
          effectType: 'vj-mix',
          vjmixRows: rows,
          vjmixGroups: groups,
        },
      } as NonNullable<Layer['source']>,
      // Display the processed mix exactly once. The row feeds remain
      // resident but must not also composite underneath it.
      effects: compositionEffects,
      edgeEffects: null,
    } as Layer,
  ];
}


export interface VjDeckCrossfade {
  /** Post-curve fader position, 0 = Deck A, 1 = Deck B. */
  mix: number;
  transition: string;
  blendMode: string;
}

/**
 * The A/B slider between whole decks. Each deck's rows (their own opacity,
 * blend and groups, plus its Performer worlds) are mixed into one picture,
 * and the slider's transition and blend mode run between the two pictures.
 * Pairing row N of Deck A with row N of Deck B only worked when both decks
 * used the same rows; this works whatever rows each deck plays on.
 */
export function appendNativeVjDeckCrossfade(
  list: Layer[],
  groups: VJGroup[],
  compositionEffects: Effect[],
  xfade: VjDeckCrossfade,
): Layer[] {
  const rowsFor = (deck: 'A' | 'B') => {
    type Row = { index: number; order: number; layerId: string; opacity: number; blendMode: string };
    const rows: Row[] = [];
    for (const layer of list) {
      const id = String(layer.id);
      const row = /^vj-layer-(\d+)-([AB])$/.exec(id);
      const world = /^performer-world-([AB])-(\d+)$/.exec(id);
      if (row && row[2] === deck) {
        rows.push({ index: Number(row[1]), order: 0, layerId: id,
          opacity: Math.max(0, Math.min(1, layer.opacity ?? 1)), blendMode: String(layer.blendMode || 'normal') });
      } else if (world && world[1] === deck && layer.visible !== false) {
        rows.push({ index: Number(world[2]), order: 1, layerId: id,
          opacity: Math.max(0, Math.min(1, layer.opacity ?? 1)), blendMode: String(layer.blendMode || 'add') });
      }
    }
    // Bottom to top: row 0 is topmost; a row's Performer world sits on it.
    return rows
      .sort((a, b) => b.index - a.index || a.order - b.order)
      .map(({ index, layerId, opacity, blendMode }) => ({
        layerId, opacity, blendMode,
        groupId: groups.find(g => index >= g.first && index <= g.last)?.id,
      }));
  };
  const effectLayer = (id: string, name: string, src: string, effectSource: { effectType: string } & Record<string, unknown>, opacity: number, effects: Effect[] = []): Layer => ({
    ...createLayer(id, name, 'media'),
    visible: true,
    opacity,
    blendMode: 'normal',
    source: { id: `${id}-src`, type: 'effect', src, name, effectSource } as unknown as NonNullable<Layer['source']>,
    effects,
    edgeEffects: null,
  } as Layer);
  // Each deck's picture and the transition between them render as feeds
  // only (opacity 0); the VJ Mix carrier presents the result once.
  const deckA = effectLayer('__vj-deck-mix-A__', 'Deck A', 'plugin://vj-mix/deck-a',
    { effectType: 'vj-mix', vjmixRows: rowsFor('A'), vjmixGroups: groups }, 0);
  const deckB = effectLayer('__vj-deck-mix-B__', 'Deck B', 'plugin://vj-mix/deck-b',
    { effectType: 'vj-mix', vjmixRows: rowsFor('B'), vjmixGroups: groups }, 0);
  const crossfade = effectLayer('__vj-deck-xfade__', 'A/B', 'plugin://vj-crossfade/decks', {
    effectType: 'vj-crossfade',
    vjxfadeLayerA: deckA.id,
    vjxfadeLayerB: deckB.id,
    vjxfadeMix: Math.max(0, Math.min(1, xfade.mix)),
    vjxfadeTransition: xfade.transition || 'dissolve',
    vjxfadeBlend: xfade.blendMode || 'normal',
    vjxfadeOpacityA: 1,
    vjxfadeOpacityB: 1,
  }, 0);
  const mix = effectLayer('__vj-mix__', 'VJ Mix', 'plugin://vj-mix', {
    effectType: 'vj-mix',
    vjmixRows: [{ layerId: crossfade.id, opacity: 1, blendMode: 'normal' }],
    vjmixGroups: [],
  }, 1, compositionEffects);
  return [...list.map(layer => ({ ...layer, opacity: 0 })), deckA, deckB, crossfade, mix];
}

/** Stage output contains screen slices and only their parent containers. */
export function vjStageScreenLayers(layers: Layer[]): Layer[] {
  const screens = layers.filter(layer => layer.type === 'screen');
  const parents = new Set(screens.map(layer => layer.parentGroupId).filter(Boolean));
  return layers.filter(layer => layer.type === 'screen' || (layer.type === 'group' && parents.has(layer.id)));
}
