/**
 * Ambient declarations for WebCodecs + WebGPU APIs used by the
 * outputSharedTexture pipeline. These APIs ship in Electron 42 /
 * Chromium 130 but TypeScript's lib.dom.d.ts (5.x) doesn't include
 * the full surface area yet. We declare just what we actually call
 * — adding @webgpu/types + @types/dom-mediacapture-transform would
 * pull ~3000 lines of declarations for two narrow APIs.
 *
 * Replace with the official packages whenever lib.dom catches up
 * (ETA: VideoFrame is already in TS 5.4+, MediaStreamTrackProcessor
 * remains in proposed; WebGPU types should land in TS 5.x).
 */

// ── WebCodecs minimal declarations ───────────────────────────────
// VideoFrame is the core frame type produced by
// MediaStreamTrackProcessor.readable. We treat it as opaque on the
// sender side (just transfer it); on the receiver we read .format,
// .codedWidth/Height, .timestamp, and call .close() to release the
// underlying GpuMemoryBuffer back to Chromium.
interface VideoFrame {
  readonly format: string | null;
  readonly codedWidth: number;
  readonly codedHeight: number;
  readonly timestamp: number;
  close(): void;
}
declare const VideoFrame: {
  prototype: VideoFrame;
  new (...args: any[]): VideoFrame;
};

interface MediaStreamTrackProcessorInit {
  track: MediaStreamTrack;
  maxBufferSize?: number;
}
interface MediaStreamTrackProcessor<T = VideoFrame> {
  readonly readable: ReadableStream<T>;
}
declare const MediaStreamTrackProcessor: {
  prototype: MediaStreamTrackProcessor<any>;
  new <T = VideoFrame>(init: MediaStreamTrackProcessorInit): MediaStreamTrackProcessor<T>;
};

// ── WebGPU minimal declarations ──────────────────────────────────
// We only need the constants and the device.importExternalTexture
// surface here. The rest is dynamically typed via `any` because the
// fluency-loss isn't worth carrying ~3000 lines of @webgpu/types
// just for the output presenter. When/if the editor renderer goes
// WebGPU, we can install @webgpu/types and remove this section.
declare const GPUShaderStage: {
  readonly VERTEX: number;
  readonly FRAGMENT: number;
  readonly COMPUTE: number;
};

declare const GPUBufferUsage: {
  readonly UNIFORM: number;
  readonly COPY_DST: number;
  readonly COPY_SRC: number;
  readonly STORAGE: number;
  readonly INDEX: number;
  readonly VERTEX: number;
  readonly INDIRECT: number;
  readonly QUERY_RESOLVE: number;
  readonly MAP_READ: number;
  readonly MAP_WRITE: number;
};

declare const GPUTextureUsage: {
  readonly RENDER_ATTACHMENT: number;
  readonly TEXTURE_BINDING: number;
  readonly STORAGE_BINDING: number;
  readonly COPY_SRC: number;
  readonly COPY_DST: number;
};
