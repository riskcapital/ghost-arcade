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


/** Stage output contains screen slices and only their parent containers. */
export function vjStageScreenLayers(layers: Layer[]): Layer[] {
  const screens = layers.filter(layer => layer.type === 'screen');
  const parents = new Set(screens.map(layer => layer.parentGroupId).filter(Boolean));
  return layers.filter(layer => layer.type === 'screen' || (layer.type === 'group' && parents.has(layer.id)));
}
