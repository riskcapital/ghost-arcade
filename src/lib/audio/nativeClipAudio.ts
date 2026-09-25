import { writable } from 'svelte/store';
import type { VJClip, VJClipLauncherState } from '../stores/vjClipLauncher';
import { vjClipTransitionKey, type VJClipTransition } from '../stores/vjClipTransitions';
export const nativeAudioMaster = writable({ volume: 1, muted: false });
/** Recordings carry the core's clip mix whenever the VJ workspace owns the
 *  output. It is silence, not absent, while muted, stopped or not live. */
export function nativeClipAudioRecordable(state: Pick<VJClipLauncherState, 'isOpen' | 'mapMode'>) {
  return state.isOpen && !state.mapMode;
}
type ClipTransitionAudio = Pick<VJClipTransition, 'token' | 'duration' | 'startedAtMs' | 'incomingClipId' | 'outgoingClip' | 'queuedTriggerId'>;
export interface NativeClipAudioVoice {
  id: string; source_id: string; gain: number; pan: number;
  /** Row key (`deck:layer`) and the picture transition this voice follows. */
  row?: string;
  transition?: { role: 'in' | 'out'; token: number; duration: number; running: boolean };
}
const audible = (clip: VJClip | null | undefined): clip is VJClip =>
  !!clip && clip.type === 'video' && clip.audioPlayback !== false && !clip.src.startsWith('live://');

/** Independent layer audio faders; visual opacity does not change sound.
 *  During a clip transition the core fades the outgoing clip out and the
 *  incoming clip in (equal power) over the transition's duration. */
export function nativeClipAudioMix(state: VJClipLauncherState, master = { volume: 1, muted: false },
  transitions: ReadonlyMap<string, ClipTransitionAudio> = new Map()) {
  const voices: NativeClipAudioVoice[] = [];
  const sources: string[] = [];
  const add = (src: string) => { if (src && !src.startsWith('live://') && !sources.includes(src)) sources.push(src); };
  for (const deck of ['A', 'B'] as const) {
    if (deck === 'B' && !state.crossfaderEnabled) continue;
    const rows = deck === 'B' ? state.bankBLayerStates : state.layerStates;
    const solo = rows.some(row => row.solo);
    const x = Math.max(0, Math.min(1, state.crossfaderValue));
    const deckGain = !state.crossfaderEnabled ? 1 : deck === 'A' ? Math.cos(x * Math.PI / 2) : Math.sin(x * Math.PI / 2);
    rows.forEach((row, index) => {
      const key = vjClipTransitionKey(deck, index);
      const fade = transitions.get(key);
      const clip = audible(row.activeClip) ? row.activeClip : null;
      const outgoing = fade && audible(fade.outgoingClip) && fade.outgoingClip.id !== clip?.id ? fade.outgoingClip : null;
      if (clip) add(clip.src);
      // The outgoing clip may have left the grid; keep its decoded audio.
      if (outgoing) add(outgoing.src);
      if (!state.isOpen || !state.isLive || state.stoppedAll || state.mapMode) return;
      const rowMuted = master.muted || row.mute || (solo && !row.solo);
      const voice = (source: VJClip, role: 'in' | 'out' | null): NativeClipAudioVoice => ({
        id: `${deck}:${index}:${source.id}`, source_id: source.id,
        gain: rowMuted || source.audioMuted ? 0 : Math.max(0, Math.min(1, source.audioVolume ?? 1)) * Math.max(0, Math.min(1, row.audioVolume ?? 1)) * deckGain * master.volume,
        pan: Math.max(-1, Math.min(1, (source.audioPan ?? 0) + (row.audioPan ?? 0))),
        ...(fade && role ? { row: key, transition: { role, token: fade.token, duration: fade.duration,
          running: fade.startedAtMs !== null && !fade.queuedTriggerId } } : {}),
      });
      // A queued launch still shows its outgoing clip: hold it at full level.
      if (clip) voices.push(voice(clip, !fade ? null : fade.incomingClipId === clip.id ? 'in' : fade.outgoingClip.id === clip.id ? 'out' : null));
      if (outgoing) voices.push(voice(outgoing, 'out'));
    });
  }
  for (const grid of [state.clipGrid, ...(state.crossfaderEnabled ? [state.bankBClipGrid] : [])]) {
    for (const row of grid) for (const clip of row) if (clip?.type === 'video' && clip.audioPlayback !== false) add(clip.src);
  }
  return { type: 'set_clip_audio_mix' as const, voices, sources: sources.slice(0, 64) };
}
