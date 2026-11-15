/**
 * The VJ rows as native scene layers once the A/B crossfader is on (or off):
 * the crossfade carriers, the single-deck rows weighted by the fader, the
 * Performer worlds and the VJ Mix carrier. Pure; Canvas.svelte feeds it the
 * launcher state and the rows (after clip transitions).
 *
 * Every value here that follows the fader is tagged (vjCrossfadeFrame.ts), so
 * the frame sync moves it on each frame and a moving fader does not rebuild
 * the scene.
 */
import type { Effect, Layer } from '../types';
import type { VJClipLauncherState } from '../stores/vjClipLauncher';
import type { VJGroup } from '../stores/vjGroups';
import type { NativePerformerWorldOverlayState } from '../stores/nativePerformerWorld';
import { appendNativeVjDeckCrossfade, appendNativeVjMixCarrier } from './vjCompositionNative';
import { makeVJClipTransitionCarrier } from './vjClipTransitionNative';
import { crossfadeShapedMix, crossfadeWeights, withCrossfadeMix, withCrossfadeOpacity } from './vjCrossfadeFrame';

type Weights = { a: number; b: number } | null;

function parseVjLayerId(id: string): { idx: number; bank?: 'A' | 'B' } | null {
  const m = /^vj-layer-(\d+)(?:-([AB]))?$/.exec(id);
  return m ? { idx: parseInt(m[1], 10), bank: m[2] as 'A' | 'B' | undefined } : null;
}

/** Each enabled Performer world as an additive layer over its row, weighted by its deck. */
export function appendPerformerWorldLayers(
  baseLayers: Layer[],
  vjLayers: Layer[],
  overlayState: NativePerformerWorldOverlayState,
  weights: Weights,
): Layer[] {
  const overlays = (['A', 'B'] as const)
    .map((deck) => overlayState[deck])
    .filter((overlay): overlay is NonNullable<typeof overlay> => !!overlay?.enabled)
    .map((overlay): Layer | null => {
      const sourceLayer = vjLayers.find((candidate) => {
        const parsed = parseVjLayerId(candidate.id);
        if (!parsed || parsed.idx !== overlay.layerIndex) return false;
        return (parsed.bank ?? 'A') === overlay.deck;
      });
      if (!sourceLayer) return null;
      const deckWeight = weights
        ? overlay.deck === 'A' ? weights.a : weights.b
        : 1;
      const world: Layer = {
        ...sourceLayer,
        id: `performer-world-${overlay.deck}-${overlay.layerIndex}`,
        name: 'Performer World',
        opacity: sourceLayer.opacity * deckWeight,
        blendMode: 'add',
        source: {
          id: `performer-world-src-${overlay.deck}-${overlay.layerIndex}`,
          type: 'effect',
          src: `plugin://performer-world/${overlay.deck}/${overlay.layerIndex}`,
          name: 'Performer World',
          effectSource: {
            effectType: 'performer-world',
            performerWorldIndex: overlay.worldIndex,
            performerWorldSpace: overlay.spaceIndex,
            performerWorldX: overlay.x,
            performerWorldY: overlay.y,
            performerWorldPointerDown: overlay.pointerDown,
            performerWorldParams: overlay.params,
            performerWorldPump: overlay.pump,
          },
        } as NonNullable<Layer['source']>,
        effects: [],
        edgeEffects: null,
      };
      return weights
        ? withCrossfadeOpacity(world, overlay.deck === 'A' ? 'a' : 'b', sourceLayer.opacity, deckWeight)
        : world;
    })
    .filter((overlay): overlay is Layer => !!overlay);
  return overlays.length ? [...overlays, ...baseLayers] : baseLayers;
}

export type VjCrossfadeSceneInput = {
  /** The rows after clip transitions (buildVJClipTransitionLayers). */
  vjLayers: Layer[];
  /** The rows as the launcher outputs them (vjOutputLayers). */
  incomingLayers: Layer[];
  state: Pick<VJClipLauncherState,
    'crossfaderEnabled' | 'crossfaderValue' | 'crossfaderCurve' | 'crossfaderTransition' | 'crossfaderBlendMode'
    | 'stageMode' | 'layerStates' | 'bankBLayerStates'>;
  overlays: NativePerformerWorldOverlayState;
  groups: VJGroup[];
  /** Composition FX on the mix carrier (none in the live modes). */
  mixEffects: Effect[];
};

/**
 * null = a derived store is one tick behind the launcher (both decks hold a
 * clip on a row, but only one is materialised); the caller skips this sync.
 */
export function buildVjCrossfadeScene(input: VjCrossfadeSceneInput): Layer[] | null {
  const { vjLayers, incomingLayers, state: vjState, overlays, groups, mixEffects } = input;
  const appendMix = (list: Layer[]) => appendNativeVjMixCarrier(list, groups, mixEffects);
  const weights = crossfadeWeights(vjState);
  if (!weights) {
    return appendMix(appendPerformerWorldLayers(vjLayers, incomingLayers, overlays, weights));
  }
  // A/B crossfade with a paired transition shader: both banks stay
  // composited at opacity 0 (their frames keep rendering — the mix
  // pass samples them via layer-frame bindings) and a synthetic
  // layer per index shows the transition output. Single-bank rows
  // fall back to fader-weighted opacity.
  const byIndex = new Map<number, { a?: Layer; b?: Layer }>();
  const output: Layer[] = [];
  for (const layer of vjLayers) {
    const parsed = parseVjLayerId(layer.id);
    if (!parsed?.bank) {
      output.push(layer);
      continue;
    }
    const slot = byIndex.get(parsed.idx) ?? {};
    if (parsed.bank === 'A') slot.a = layer;
    else slot.b = layer;
    byIndex.set(parsed.idx, slot);
  }
  // Mix value handed to the native transition shader (crossfadeShapedMix:
  // 'constant-power' passes the raw fader, each transition shapes it).
  const shapedMix = crossfadeShapedMix(vjState);
  const stateA = vjState.layerStates ?? [];
  const stateB = vjState.bankBLayerStates ?? [];
  // Mix output with both decks playing: the slider runs between the
  // whole Deck A and Deck B pictures, so its transition and blend mode
  // apply whatever rows each deck uses. Stage keeps the per-row pairing
  // below, because each Screen shows one row's own A/B mix.
  const slots = [...byIndex.values()];
  if (!vjState.stageMode && slots.some(slot => slot.a) && slots.some(slot => slot.b)) {
    const residents: Layer[] = [...output];
    for (const slot of slots) {
      if (slot.a) residents.push({ ...slot.a, _deckMonitorBank: 'a', _deckMonitorOpacity: slot.a.opacity });
      if (slot.b) residents.push({ ...slot.b, _deckMonitorBank: 'b', _deckMonitorOpacity: slot.b.opacity });
    }
    return appendNativeVjDeckCrossfade(
      appendPerformerWorldLayers(residents, incomingLayers, overlays, null),
      groups,
      mixEffects,
      {
        mix: shapedMix,
        transition: vjState.crossfaderTransition || 'dissolve',
        blendMode: vjState.crossfaderBlendMode || 'normal',
      },
    );
  }
  // A MAP preset occupies a row without producing a feed, so it never
  // counts as the missing half of an A/B pair.
  const visibleRow = (rows: typeof stateA, idx: number) => !!rows[idx]?.activeClip
    && rows[idx].activeClip!.type !== 'preset'
    && !rows[idx].mute && (!rows.some(row => row.solo) || rows[idx].solo);
  for (const [idx, slot] of byIndex.entries()) {
    // Derived-store lag guard: the launcher state says both decks
    // hold a clip on this row, but vjOutputLayers has only one bank
    // materialized. Emitting the single-bank weighted version now
    // would flip the scene shape for one tick (visible as a black
    // blink and constant template churn). Signal "stale" instead.
    const bothActive = visibleRow(stateA, idx) && visibleRow(stateB, idx);
    if (bothActive && (!slot.a || !slot.b)) {
      return null;
    }
    if (slot.a && slot.b) {
      output.push({ ...slot.a, opacity: 0, _deckMonitorBank: 'a', _deckMonitorOpacity: slot.a.opacity });
      output.push({ ...slot.b, opacity: 0, _deckMonitorBank: 'b', _deckMonitorOpacity: slot.b.opacity });
      // Its layer settings come from the deck the fader is nearer
      // (crossfadeSceneStep), its mix follows the fader per frame.
      output.push(withCrossfadeMix(makeVJClipTransitionCarrier(
        shapedMix < 0.5 ? slot.a : slot.b,
        slot.a.id, slot.b.id, shapedMix,
        vjState.crossfaderTransition || 'dissolve',
        {
          id: `vj-xfade-${idx}`,
          opacityA: slot.a.opacity, opacityB: slot.b.opacity,
          blendMode: vjState.crossfaderBlendMode || 'normal',
        },
      )));
      continue;
    }
    const single = slot.a ?? slot.b;
    if (!single) continue;
    const deck = slot.a ? 'a' : 'b';
    output.push(withCrossfadeOpacity({
      ...single,
      _deckMonitorBank: deck,
      _deckMonitorOpacity: single.opacity,
    }, deck, single.opacity, weights[deck]));
  }
  return appendMix(appendPerformerWorldLayers(output, incomingLayers, overlays, weights));
}
