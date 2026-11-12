/**
 * Bundled shaders made for Music motion (they declare mmFlow / mmSwell /
 * mmPulse / mmMorph). Lists that only know a shader's file name, like the
 * Shader Library, read this; anywhere with the code uses
 * shaderIsMusicMotionReady(code). musicMotionShaders.test.ts recomputes it
 * from public/ISF, so it can't drift.
 */
export const MUSIC_MOTION_SHADER_FILES: readonly string[] = [
  'Featured-aurora.fs',
  'Featured-lumenveil.fs',
  'Featured-prism.fs',
];

const READY = new Set(MUSIC_MOTION_SHADER_FILES);

/** True for a bundled shader file (path or base name) made for Music motion. */
export function isMusicMotionShaderFile(file: string | null | undefined): boolean {
  if (!file) return false;
  return READY.has(file.split('/').pop() ?? file);
}
