/**
 * Silence THREE.Texture.toJSON noise.
 *
 * `JSON.stringify` calls `value.toJSON()` BEFORE invoking any replacer function.
 * THREE.Texture.prototype.toJSON emits `console.error("THREE.Texture: Unable
 * to serialize Texture.")` whenever it can't find an image source. This app
 * never persists THREE scenes via Three's own JSON format, so the warning is
 * pure noise — but several code paths (autosave, state broadcast, preset
 * snapshots, history) walk object trees that may contain live textures, and
 * each visit triggers the log. At frame rate this floods stderr and drops FPS
 * from 60 to single digits.
 *
 * We replace toJSON with a silent stub that returns a minimal descriptor.
 * No code in this app consumes the serialized texture output, so the exact
 * shape is irrelevant — only the absence of the console spam matters.
 */
import { Texture, WebGLRenderTarget } from 'three';

let patched = false;

export function silenceThreeSerializationNoise(): void {
  if (patched) return;
  patched = true;

  const stub = function (this: any) {
    return {
      uuid: this?.uuid ?? undefined,
      name: this?.name ?? undefined,
      __stubbedFromToJSON: true,
    };
  };

  try { (Texture.prototype as any).toJSON = stub; } catch { /* frozen prototype */ }
  try { (WebGLRenderTarget.prototype as any).toJSON = stub; } catch { /* no-op */ }
}
