/**
 * An instrument's visual voice (instrumentDress.ts), kept in the studio's
 * visuals. Apart from instrumentDress.ts so the studio store, which reads
 * the dress, does not pull in the visuals.
 */

import type { InstrumentId } from './noteEvents';
import type { ClipVisual } from './session';
import { MAX_STUDIO_VOICES, type StudioVoice } from './studioPlugin';
import { editStudio, studioTargetNow } from './studioTarget';
import type { VoiceSourceId } from './visualVoices';

const voiceTag = (instrument: InstrumentId) => `inst:${instrument}`;

/** Put the instrument's visual voice in the studio's visuals (or take it out), matching its dress. */
export function syncDressVisual(instrument: InstrumentId, visual: ClipVisual | undefined): void {
  const target = studioTargetNow();
  if (!target) return;
  const tag = voiceTag(instrument);
  const has = target.source.musicVoices.find((v) => v.clip === tag);
  if (!visual) {
    if (has) editStudio((src) => ({ ...src, musicVoices: src.musicVoices.filter((v) => v.clip !== tag) }));
    return;
  }
  const voice: StudioVoice = {
    file: visual.file,
    source: visual.source as VoiceSourceId,
    auto: true,
    level: visual.level,
    blend: visual.blend as StudioVoice['blend'],
    params: has && has.file === visual.file ? has.params : {},
    clip: tag,
  };
  if (has) editStudio((src) => ({ ...src, musicVoices: src.musicVoices.map((v) => (v.clip === tag ? voice : v)) }));
  else if (target.source.musicVoices.length < MAX_STUDIO_VOICES) editStudio((src) => ({ ...src, musicVoices: [...src.musicVoices, voice] }));
}
