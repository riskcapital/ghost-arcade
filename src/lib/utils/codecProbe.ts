/**
 * Which video codecs WebRTC can negotiate here -- used by Settings ->
 * Performance to offer the output-stream codec choices.
 *
 * `probeEncodeSupport()` enumerates `RTCRtpSender.getCapabilities` for the
 * codecs WebRTC can negotiate. It does not tell hardware from software encode
 * (the API doesn't expose that), only which mimeTypes the dropdown should
 * offer. Cached: results don't change at runtime.
 *
 * Video *decoding* is not probed here any more. Chromium's MediaCapabilities
 * answer could call VP9 or AV1 "Hardware" although the render core always
 * decodes them on the CPU; the Video Decoding panel now asks the core
 * (src/lib/video/decodeCapabilities.ts).
 */

export interface CodecEncodeReport {
  vp8: boolean;
  vp9: boolean;
  h264: boolean;
  av1: boolean;
}

let _encodeCache: CodecEncodeReport | null = null;

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
