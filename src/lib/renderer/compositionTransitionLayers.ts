/**
 * Native composition transition — the two-stack per-layer opacity crossfade.
 *
 * WHY THIS AND NOT A TRANSITION SHADER
 * ------------------------------------
 * `renderer/vjCrossfadeNative.ts` is a real two-input transition pass with
 * ten named styles, and routing a composition swap through it would have
 * given all ten for free. It cannot be used here: it blends two
 * `layer-frame:<id>` textures, i.e. the composited frame of ONE scene layer
 * each. A mapping composition is a whole stack of layers with per-layer
 * warp/corner geometry, and the core has no pass that composites a SUBSET
 * of scene layers into a source frame — the only full composite it builds is
 * the output itself. Getting `vjCrossfadeNative` two mapping composites
 * would mean adding an offscreen scene-composite target to the Rust core and
 * running the whole scene twice per frame.
 *
 * So instead: during a transition BOTH compositions' layers are resident in
 * the scene at the same time and the compositor — which already composites
 * per-layer alpha correctly — does the blend. No new core machinery, one
 * scene, and it is exactly what a VJ does by hand with two decks.
 *
 * WHAT THAT COSTS
 * ---------------
 * • Layer count spikes to the sum of both stacks. `MAX_SCENE_LAYERS` is 64
 *   in the core (native-renderer/src/main.rs), so `MAX_TRANSITION_LAYERS`
 *   below refuses the transition rather than letting the core silently
 *   truncate the stack — a hard cut beats half a scene.
 * • Only envelopes expressible as per-layer alpha (+ a blend override) are
 *   possible. That is the entire reason `CompositionTransitionStyle` has
 *   three members and not eleven.
 * • `over` compositing cannot crossfade two PARTIAL-coverage stacks exactly:
 *   with the outgoing on top at α_out and the incoming beneath at α_in, a
 *   pixel both stacks cover reads `In·α_in·(1−α_out) + Out·α_out`. Both
 *   endpoints are exact (α_out=1 → pure outgoing, α_out=0 → pure incoming)
 *   and constant-power weights hold the midpoint at ~0.91 of full power
 *   instead of 1.0. Making it exact would require α_in = 1 throughout, which
 *   pops the incoming picture into every region the outgoing stack does not
 *   cover. The ~9% midpoint dip is the better artifact.
 *
 * SCENE STABILITY ACROSS THE MIDPOINT
 * -----------------------------------
 * The transition window is CENTRED on the clip boundary, so the composition
 * swap (`loadComposition`) happens halfway through it. Before the swap the
 * live stack is the outgoing composition and the transient clone is the
 * incoming one; after it, the roles reverse. Because the clone reuses the
 * composition's own layer ids, the SET of scene layer ids and their order
 * are identical on both sides of the swap — only the opacities move. The
 * core therefore sees no add/remove churn at the midpoint, which is what
 * keeps video and shader sources from re-warming while they are on screen.
 *
 * Ids are namespaced only when the two stacks actually collide (a
 * save-as-copy of the same composition keeps its layer ids). That case
 * accepts the churn; the common case has none.
 */

import type { BlendMode, CompositionTransitionStyle, Layer } from '../types';

/** Mirrors `MAX_SCENE_LAYERS` in native-renderer/src/main.rs. The core
 *  `.take(MAX_SCENE_LAYERS)`s the sorted layer list, so anything past this
 *  is silently dropped — refuse the transition instead. */
export const MAX_TRANSITION_LAYERS = 64;

/** Prefix for the transient stack when — and only when — the two
 *  compositions share layer ids. */
export const TRANSITION_LAYER_PREFIX = 'showfade::';

/** The live, time-resolved state of a composition transition. Published by
 *  whatever owns the clock (the show timeline from `seek()`, the preset tray
 *  from a wall clock) and consumed here. */
export interface ActiveCompositionTransition {
  style: CompositionTransitionStyle;
  /** 0 = outgoing fully live, 1 = incoming fully live. */
  progress: number;
  /** Composition being faded AWAY from. */
  fromCompositionId: string;
  /** Composition being revealed. */
  toCompositionId: string;
}

export interface CompositionTransitionWeights {
  /** Opacity multiplier for the outgoing stack. */
  outgoing: number;
  /** Opacity multiplier for the incoming stack. */
  incoming: number;
  /** When set, every incoming layer's blend mode is replaced with this. */
  incomingBlend: BlendMode | null;
  /** true = incoming layers render ABOVE the outgoing ones. */
  incomingOnTop: boolean;
}

const HALF_PI = Math.PI / 2;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * Per-style opacity envelope. Pure — the offline renderer and the live
 * transport get the identical answer for the identical progress, which is
 * what makes a cold seek into the middle of a transition land in a fully
 * resolved state with no animation to catch up on.
 */
export function compositionTransitionWeights(
  style: CompositionTransitionStyle,
  progress: number,
): CompositionTransitionWeights {
  const p = clamp01(progress);
  switch (style) {
    case 'dipToBlack':
      // A real black moment at the midpoint: the outgoing stack is gone by
      // p=0.5 and the incoming one only starts after it.
      return {
        outgoing: Math.max(0, 1 - 2 * p),
        incoming: Math.max(0, 2 * p - 1),
        incomingBlend: null,
        incomingOnTop: false,
      };
    case 'additive':
      // Incoming blooms in ON TOP with an additive blend, so the overlap is
      // brighter than either side rather than a straight average.
      return {
        outgoing: 1 - p,
        incoming: p,
        incomingBlend: 'add',
        incomingOnTop: true,
      };
    case 'dissolve':
    default:
      // Constant power — the same cos/sin pair the VJ crossfader and
      // `vjCrossfadeNative`'s dissolve use, so a show boundary and a fader
      // throw have the same perceptual midpoint.
      return {
        outgoing: Math.cos(p * HALF_PI),
        incoming: Math.sin(p * HALF_PI),
        incomingBlend: null,
        incomingOnTop: false,
      };
  }
}

function scaleOpacity(layer: Layer, weight: number, blend: BlendMode | null): Layer {
  const next = { ...layer } as Layer;
  next.opacity = clamp01((layer.opacity ?? 1) * weight);
  if (blend) next.blendMode = blend;
  return next;
}

/**
 * Rewrite a whole stack under `TRANSITION_LAYER_PREFIX`, keeping group
 * parentage consistent. All-or-nothing on purpose: renaming only the
 * colliding ids would orphan a group child from its container.
 */
function namespaceStack(layers: Layer[]): Layer[] {
  return layers.map((layer) => {
    const next = { ...layer } as Layer;
    next.id = TRANSITION_LAYER_PREFIX + layer.id;
    const parent = (layer as { parentGroupId?: string | null }).parentGroupId;
    if (parent) {
      (next as { parentGroupId?: string | null }).parentGroupId = TRANSITION_LAYER_PREFIX + parent;
    }
    return next;
  });
}

export interface BuildCompositionTransitionArgs {
  /** `project.layers` — whichever composition is currently loaded. */
  liveLayers: Layer[];
  /** `project.vjMode.activeCompositionId`. */
  activeCompositionId: string | null;
  /** Resolved transition state, or null when nothing is in flight. */
  transition: ActiveCompositionTransition | null;
  /** Saved layer stack for a composition id, or null when it is gone. */
  compositionLayers: (compositionId: string) => Layer[] | null;
  /** Test seam. Defaults to the core's own ceiling. */
  maxLayers?: number;
}

/**
 * Effective scene layer list for the current instant.
 *
 * Returns `liveLayers` untouched whenever nothing is transitioning, so the
 * ordinary path costs one comparison. During a transition it returns both
 * stacks, ordered so the topmost entry is at index 0 (the native sync sends
 * `z_index = index` and the core blends the largest z first).
 */
export function buildCompositionTransitionLayers(
  args: BuildCompositionTransitionArgs,
): Layer[] {
  const { liveLayers, activeCompositionId, transition, compositionLayers } = args;
  const maxLayers = args.maxLayers ?? MAX_TRANSITION_LAYERS;
  if (!transition) return liveLayers;
  const { fromCompositionId, toCompositionId } = transition;
  // A composition crossfading into itself is a no-op that would only cost a
  // doubled layer count (and guarantee an id collision).
  if (!fromCompositionId || !toCompositionId || fromCompositionId === toCompositionId) {
    return liveLayers;
  }

  // Which side is already loaded decides which side has to be cloned. Before
  // the midpoint that is the outgoing composition; after it, the incoming.
  let outgoing: Layer[] | null;
  let incoming: Layer[] | null;
  if (activeCompositionId === toCompositionId) {
    incoming = liveLayers;
    outgoing = compositionLayers(fromCompositionId);
  } else if (activeCompositionId === fromCompositionId) {
    outgoing = liveLayers;
    incoming = compositionLayers(toCompositionId);
  } else {
    // The operator punched in a third composition mid-transition (or the
    // project has no active composition at all). Neither side is what is on
    // screen, so blending them would be a lie — show what is loaded.
    return liveLayers;
  }
  if (!outgoing?.length || !incoming?.length) return liveLayers;

  if (outgoing.length + incoming.length > maxLayers) {
    // Truncation would drop whichever layers sort last, which is not a
    // transition — it is a broken scene. Hard-cut instead.
    return liveLayers;
  }

  // Namespace the cloned side only when the ids actually collide.
  const liveIds = new Set(liveLayers.map((l) => String(l.id)));
  const cloneIsOutgoing = outgoing !== liveLayers;
  const clone = cloneIsOutgoing ? outgoing : incoming;
  if (clone.some((l) => liveIds.has(String(l.id)))) {
    const namespaced = namespaceStack(clone);
    if (cloneIsOutgoing) outgoing = namespaced;
    else incoming = namespaced;
  }

  const w = compositionTransitionWeights(transition.style, transition.progress);
  const outLayers = outgoing.map((l) => scaleOpacity(l, w.outgoing, null));
  const inLayers = incoming.map((l) => scaleOpacity(l, w.incoming, w.incomingBlend));
  return w.incomingOnTop ? [...inLayers, ...outLayers] : [...outLayers, ...inLayers];
}
