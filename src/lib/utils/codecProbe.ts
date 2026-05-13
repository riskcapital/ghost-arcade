/**
 * Codec capability probes — used by Settings → Performance to show
 * the user which video codecs their machine can decode/encode and
 * (for decode) whether the path is hardware-accelerated.
 *
 * Two probes:
 *   1. `probeDecodeSupport()` — runs MediaCapabilities API against a
 *      representative config for each codec. Returns each codec's
 *      decode support: 'hw' (smooth + powerEfficient), 'sw'
 *      (supported but not power-efficient — software decode), or
 *      'no' (unsupported). HW = no battery drain + low CPU.
 *   2. `probeEncodeSupport()` — enumerates `RTCRtpSender.getCapabilities`
 *      for the codecs WebRTC can negotiate. Doesn't tell us HW vs SW
 *      encode (the API doesn't expose that), but tells us which
 *      mimeTypes the Settings dropdown should offer.
 *
 * Async + cached. The probe is async because MediaCapabilities
 * returns a Promise; cache because re-probing on every settings panel
 * open is wasteful (results don't change at runtime).
 */

export type DecodeSupport = 'hw' | 'sw' | 'no' | 'unknown';

export interface CodecDecodeReport {
  h264: DecodeSupport;
  hevc: DecodeSupport;
  vp9: DecodeSupport;
  av1: DecodeSupport;
}

export interface CodecEncodeReport {
  vp8: boolean;
  vp9: boolean;
  h264: boolean;
  av1: boolean;
}

let _decodeCache: CodecDecodeReport | null = null;
let _encodeCache: CodecEncodeReport | null = null;

/** Representative 1080p30 video config for each codec. We test at a
 *  size users actually run VJ content at; "supported but not at this
 *  res" is meaningfully different from "supported and hardware fast". */
const PROBE_CONFIGS: Array<{ codec: keyof CodecDecodeReport; contentType: string }> = [
  // H.264 baseline profile level 3.1 — broadest compatibility config.
  { codec: 'h264', contentType: 'video/mp4; codecs="avc1.42E01F"' },
  // HEVC main profile level 4.0
  { codec: 'hevc', contentType: 'video/mp4; codecs="hvc1.1.6.L120.B0"' },
  // VP9 profile 0
  { codec: 'vp9',  contentType: 'video/webm; codecs="vp09.00.51.08"' },
  // AV1 main profile level 4.0
  { codec: 'av1',  contentType: 'video/mp4; codecs="av01.0.04M.08"' },
];

export async function probeDecodeSupport(): Promise<CodecDecodeReport> {
  if (_decodeCache) return _decodeCache;
  const result: CodecDecodeReport = { h264: 'unknown', hevc: 'unknown', vp9: 'unknown', av1: 'unknown' };

  const mc: any = (typeof navigator !== 'undefined') ? (navigator as any).mediaCapabilities : null;
  if (!mc?.decodingInfo) {
    _decodeCache = result;
    return result;
  }

  for (const cfg of PROBE_CONFIGS) {
    try {
      const info = await mc.decodingInfo({
        type: 'media-source',
        video: {
          contentType: cfg.contentType,
          width: 1920,
          height: 1080,
          bitrate: 8_000_000,
          framerate: 30,
        },
      });
      if (!info?.supported) {
        result[cfg.codec] = 'no';
      } else if (info.powerEfficient && info.smooth) {
        // HW decode: smooth playback + power-efficient = the GPU/SoC
        // has a dedicated decoder block doing the work.
        result[cfg.codec] = 'hw';
      } else {
        // Supported but not power-efficient = software decode path.
        // Playback works, just costs CPU.
        result[cfg.codec] = 'sw';
      }
    } catch {
      result[cfg.codec] = 'unknown';
    }
  }

  _decodeCache = result;
  return result;
}

export function probeEncodeSupport(): CodecEncodeReport {
  if (_encodeCache) return _encodeCache;
  const result: CodecEncodeReport = { vp8: false, vp9: false, h264: false, av1: false };

  try {
    const caps = (RTCRtpSender as any).getCapabilities?.('video');
    if (caps?.codecs) {
      for (const c of caps.codecs) {
        const mt = (c.mimeType || '').toLowerCase();
        if (mt === 'video/vp8')  result.vp8 = true;
        if (mt === 'video/vp9')  result.vp9 = true;
        if (mt === 'video/h264') result.h264 = true;
        if (mt === 'video/av1')  result.av1 = true;
      }
    }
  } catch { /* SDK / environment without RTC — leave all false */ }

  _encodeCache = result;
  return result;
}

/** Pretty-print a DecodeSupport value for the UI. */
export function formatDecodeSupport(s: DecodeSupport): string {
  switch (s) {
    case 'hw':      return 'Hardware';
    case 'sw':      return 'Software';
    case 'no':      return 'Not supported';
    case 'unknown': return 'Unknown';
  }
}
