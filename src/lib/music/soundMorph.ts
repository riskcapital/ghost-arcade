/**
 * What the sound engine hears on top of the saved knobs and faders: the dub
 * throw (echo up) and drop (drums and bass out) while held.
 *
 * The sound bath's XY pad plays its own tone only. It used to crossfade the
 * drone against the bowls (X) and push the reverb and shimmer mixes (Y),
 * whose dry/wet crossfade turned everything through the rack down, so
 * playing the pad quieted the other sounds. It no longer touches them.
 */

import type { InstrumentId } from './noteEvents';

interface MorphState {
  set: string;
  params: Record<string, number>;
  volumes: Record<InstrumentId, number>;
}

export function soundParamsFor(s: MorphState, throwHeld: boolean): Record<string, number> {
  if (s.set === 'dub' && throwHeld) {
    return {
      ...s.params,
      'fx.echo.mix': 1,
      'fx.echo.feedback': Math.min(1, (s.params['fx.echo.feedback'] ?? 0.6) + 0.25),
    };
  }
  return s.params;
}

export function morphedVolumesFor(s: MorphState, dropHeld: boolean): Record<InstrumentId, number> {
  if (s.set === 'dub' && dropHeld) return { ...s.volumes, drums: 0, dubbass: 0 };
  return s.volumes;
}
