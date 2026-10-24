/**
 * The input picture of the GPU shaders that build from one.
 *
 * Pixel Particles, Flythrough and Particle Field's media mode turn an image
 * or video into geometry. With no input picked they draw nothing and their
 * panel asks for one; there is no stand-in picture, because a stand-in read
 * as the user's own source having been lost.
 */
import type { GpuShaderDef } from './gpuShaderTypes';

/** Does this shader build its picture from an input image or video? */
export function gpuShaderNeedsInput(
  shaderId: string | null | undefined,
  params?: Record<string, unknown> | null,
): boolean {
  const id = String(shaderId ?? '').trim().toLowerCase();
  if (id === 'pixel-particles' || id === 'flythrough') return true;
  if (id === 'particle-field' || id === 'gravity-wells') {
    return String(params?.mode ?? '').trim().toLowerCase() === 'media';
  }
  return false;
}

/**
 * Has the operator picked an input? Only the picker's own value counts: a
 * picked input that cannot be read (a missing media item, a codec the
 * native path cannot take) is still picked and has its own message.
 */
export function gpuSourceParamIsBound(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const source = value as Record<string, unknown>;
  const type = String(source.type ?? '').trim();
  if (!type) return false;
  switch (type) {
    case 'media': return !!String(source.mediaId ?? '').trim();
    case 'layer': return !!String(source.layerId ?? '').trim();
    case 'file': return !!String(source.url ?? '').trim();
    case 'camera': return true;
    case 'spout': return !!String(source.senderName ?? '').trim();
    default: return true;
  }
}

/** This layer's shader needs an input and none is picked yet. */
export function gpuLayerAwaitingInput(
  shaderId: string | null | undefined,
  params?: Record<string, unknown> | null,
): boolean {
  return gpuShaderNeedsInput(shaderId, params) && !gpuSourceParamIsBound(params?.source);
}

// Picker source kinds as the schema names them ('live' covers camera and
// screen/texture sharing).
function pickerKind(type: string): string {
  return type === 'camera' || type === 'spout' ? 'live' : type;
}

/**
 * Params for a shader switch that bring the picked input along. Switching
 * from one input-driven shader to another (Flythrough to Pixel Particles)
 * keeps the picture you chose, unless the new shader already has an input
 * of its own from earlier.
 */
export function carryGpuShaderInput(
  previousShaderId: string | null | undefined,
  previousParams: Record<string, any> | null | undefined,
  nextShaderId: string,
  nextParams: Record<string, any>,
  nextDef: Pick<GpuShaderDef, 'paramSchema'> | null | undefined,
): Record<string, any> {
  const picked = previousParams?.source;
  if (!gpuSourceParamIsBound(picked)) return nextParams;
  if (gpuSourceParamIsBound(nextParams.source)) return nextParams;
  if (!gpuShaderNeedsInput(previousShaderId, previousParams)) return nextParams;
  if (!gpuShaderNeedsInput(nextShaderId, nextParams)) return nextParams;
  const slot = (nextDef?.paramSchema ?? []).find((p: any) => p.key === 'source' && p.kind === 'media-source') as
    | { sources?: string[] }
    | undefined;
  if (!slot) return nextParams;
  if (slot.sources && !slot.sources.includes(pickerKind(String(picked.type)))) return nextParams;
  return { ...nextParams, source: { ...picked } };
}
