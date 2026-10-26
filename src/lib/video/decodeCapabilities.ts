/**
 * What plays in hardware on this computer, as the render core sees it.
 *
 * Settings > Performance > Video Decoding used to show Chromium's
 * MediaCapabilities answer, which could say VP9 or AV1 decode in hardware
 * although the render core always decodes them on the CPU. Now the core
 * probes a short clip in each common format.
 */
import { invoke, isDesktopApp } from '$lib/bridge';
import { probeNativeVideo } from '$lib/api/native-renderer';
import { decodeHealthFromProbe, type VideoDecodeState } from './videoDecodeHealth';

export interface DecodeCapabilityRow {
  id: string;
  label: string;
  state: VideoDecodeState | 'unknown';
  verdict: string;
  reason: string;
}

type TestClip = { id: string; label: string; path: string };

export function decodeVerdict(state: DecodeCapabilityRow['state'], backend: string): string {
  if (state === 'hardware') return backend === 'hap-texture' ? 'GPU (HAP)' : 'Hardware';
  if (state === 'software') return 'Software — may lag';
  if (state === 'failed') return "Can't play";
  return 'Not checked';
}

export async function checkDecodeCapabilities(deps: {
  clips?: () => Promise<TestClip[]>;
  probe?: typeof probeNativeVideo;
} = {}): Promise<DecodeCapabilityRow[]> {
  if (!isDesktopApp && !deps.clips) return [];
  const clips = await (deps.clips ?? (() => invoke<TestClip[]>('video_decode_test_clips')))();
  const probe = deps.probe ?? probeNativeVideo;
  const rows: DecodeCapabilityRow[] = [];
  for (const clip of clips ?? []) {
    const result = await probe(clip.path).catch(() => null);
    if (!result) {
      rows.push({ id: clip.id, label: clip.label, state: 'unknown', verdict: decodeVerdict('unknown', ''), reason: 'The render core is not running.' });
      continue;
    }
    const health = decodeHealthFromProbe(result);
    rows.push({
      id: clip.id,
      label: clip.label,
      state: health.state,
      verdict: decodeVerdict(health.state, health.backend),
      reason: health.state === 'hardware' ? '' : health.reason,
    });
  }
  return rows;
}
