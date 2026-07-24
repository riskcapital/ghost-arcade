type DecodedVideoFrameState = Pick<
  HTMLVideoElement,
  'readyState' | 'videoWidth' | 'videoHeight'
>;

/** True only when Chromium has decoded a frame that WebGL can upload. */
export function hasDecodedVideoFrame(video: DecodedVideoFrameState | null | undefined): boolean {
  return !!video && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0;
}

/** A warmed VideoTexture is reusable only when it wraps the active element. */
export function isReusableVideoTexture(
  texture: { image?: unknown } | null | undefined,
  video: DecodedVideoFrameState | null | undefined,
): boolean {
  return !!texture && texture.image === video && hasDecodedVideoFrame(video);
}
