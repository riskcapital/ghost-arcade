import { writable } from 'svelte/store';
import type { VJClipLauncherState } from '../stores/vjClipLauncher';
export const nativeAudioMaster = writable({ volume: 1, muted: false });
/** Independent layer audio faders; visual opacity does not change sound. */
export function nativeClipAudioMix(state: VJClipLauncherState, master = { volume: 1, muted: false }) {
  const voices: Array<{ id: string; source_id: string; gain: number; pan: number }> = [];
  const sources: string[] = [];
  const add = (src: string) => { if (src && !src.startsWith('live://') && !sources.includes(src)) sources.push(src); };
  for (const deck of ['A', 'B'] as const) {
    if (deck === 'B' && !state.crossfaderEnabled) continue;
    const rows = deck === 'B' ? state.bankBLayerStates : state.layerStates;
    const solo = rows.some(row => row.solo);
    const x = Math.max(0, Math.min(1, state.crossfaderValue));
    const deckGain = !state.crossfaderEnabled ? 1 : deck === 'A' ? Math.cos(x * Math.PI / 2) : Math.sin(x * Math.PI / 2);
    rows.forEach((row, index) => {
      const clip = row.activeClip;
      if (!clip || clip.type !== 'video' || clip.audioPlayback === false || clip.src.startsWith('live://')) return;
      add(clip.src);
      if (!state.isOpen || !state.isLive || state.stoppedAll || state.mapMode) return;
      const muted = master.muted || row.mute || (solo && !row.solo) || clip.audioMuted;
      voices.push({ id: `${deck}:${index}:${clip.id}`, source_id: clip.id,
        gain: muted ? 0 : Math.max(0, Math.min(1, clip.audioVolume ?? 1)) * Math.max(0, Math.min(1, row.audioVolume ?? 1)) * deckGain * master.volume,
        pan: Math.max(-1, Math.min(1, (clip.audioPan ?? 0) + (row.audioPan ?? 0))) });
    });
  }
  for (const grid of [state.clipGrid, ...(state.crossfaderEnabled ? [state.bankBClipGrid] : [])]) {
    for (const row of grid) for (const clip of row) if (clip?.type === 'video' && clip.audioPlayback !== false) add(clip.src);
  }
  return { type: 'set_clip_audio_mix' as const, voices, sources: sources.slice(0, 64) };
}
