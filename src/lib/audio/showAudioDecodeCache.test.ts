/**
 * Decoded songs (≈10 MB a minute) are let go when another show is loaded or
 * the show is cleared, unless the new show still uses them.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cachedShowAudioDecode, decodeShowAudio, retainShowAudioDecodes } from './showAudio';
import { showTimeline } from '../stores/showTimeline';

function stubDecoder() {
  vi.stubGlobal('fetch', async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
  vi.stubGlobal('OfflineAudioContext', class {
    async decodeAudioData() {
      return { numberOfChannels: 1, length: 4, sampleRate: 4, duration: 1, getChannelData: () => new Float32Array(4) };
    }
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('decoded song cache', () => {
  it('keeps only the songs asked for', async () => {
    stubDecoder();
    await decodeShowAudio('song://a');
    await decodeShowAudio('song://b');
    retainShowAudioDecodes(new Set(['song://b']));
    expect(cachedShowAudioDecode('song://a')).toBeNull();
    expect(cachedShowAudioDecode('song://b')).not.toBeNull();
  });

  it('lets go of every decode when the show is cleared', async () => {
    stubDecoder();
    await decodeShowAudio('song://c');
    expect(cachedShowAudioDecode('song://c')).not.toBeNull();
    showTimeline.clear();
    await Promise.resolve();
    expect(cachedShowAudioDecode('song://c')).toBeNull();
  });
});
