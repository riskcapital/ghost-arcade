/**
 * SpoutCanvasReceiver — minimal, self-contained receiver that turns a
 * Spout (Windows) / Syphon (macOS) sender into a raw RGBA frame
 * stream suitable for direct upload to a WebGPU texture.
 *
 * Why this exists separately from the existing Canvas.svelte spout
 * receivers: those write into THREE.DataTextures wired into the media-
 * layer pipeline. The gpu-layer pixel-particles shader is a WebGPU
 * consumer; the cleanest hand-off is just `device.queue.writeTexture`
 * straight from the IPC byte buffer (no canvas / ImageData intermediate).
 *
 * Both desktop transports are supported:
 *   - Electron: invoke('spout_start_receiver') + RAF-polled
 *     invoke('spout_receive_frame'). The native addon hands back
 *     {data: ArrayBuffer, width, height} of premultiplied RGBA.
 *   - Tauri: HTTP GET http://127.0.0.1:9002/spout/receive/<sender>
 *     with body = raw RGBA pixels for the previously-negotiated size.
 *
 * Pipeline cost: native side reads the Spout DX11/IOSurface into CPU
 * RGBA (one unavoidable readback), IPC moves the buffer, and we hand
 * the same buffer to WebGPU's writeTexture. There is NO extra CPU →
 * canvas → driver upload round trip on the JS side. Consumers ask
 * for the latest frame via `getLatestFrame()` and feed the bytes
 * straight to the GPU.
 */

import { invoke, isElectron } from '$lib/bridge';

export interface SpoutFrame {
  /** RGBA8 pixel data, premultiplied. Length === width * height * 4. */
  data: Uint8Array;
  width: number;
  height: number;
  /** Monotonically-increasing counter — bump on every successful
   *  receive. Consumers can compare against the previous value to
   *  skip uploading the same frame twice. */
  frameId: number;
}

interface ReceiverState {
  senderName: string;
  width: number;
  height: number;
  active: boolean;
  rafId: number | null;
  inFlight: boolean;
  reuseBuf: Uint8Array | null;
  /** Frame is null until the first successful receive, so consumers
   *  know whether the buffer has real pixels yet. */
  latestFrame: SpoutFrame | null;
  errorLogCount: number;
}

export class SpoutCanvasReceiver {
  private state: ReceiverState | null = null;
  private startPromise: Promise<void> | null = null;

  /** Currently-selected sender, or '' when stopped. */
  get senderName(): string { return this.state?.senderName ?? ''; }

  /** Most recent frame, or null if none has arrived yet. The Uint8Array
   *  is reused across frames — copy it if you need to retain it past
   *  the next poll. WebGPU's writeTexture copies internally so calling
   *  it inline is safe. */
  getLatestFrame(): SpoutFrame | null { return this.state?.latestFrame ?? null; }

  /** Number of frames received since start. */
  get frameCount(): number { return this.state?.latestFrame?.frameId ?? 0; }

  /** Switch to a different sender. No-op if already on this one. */
  async setSender(senderName: string): Promise<void> {
    if (this.state?.senderName === senderName) return;
    this.stop();
    if (!senderName) return;
    this.startPromise = this.startInternal(senderName);
    try { await this.startPromise; } finally { this.startPromise = null; }
  }

  private async startInternal(senderName: string): Promise<void> {
    let width = 1920;
    let height = 1080;
    try {
      // Electron addon expects a session start; Tauri's HTTP path also
      // benefits from registering interest so the worker thread starts
      // pushing frames into its hashmap. Failures here are non-fatal —
      // the polling loop will keep trying until it gets data.
      const info = await invoke<{ name: string; width: number; height: number; connected: boolean }>(
        'spout_start_receiver',
        { senderName },
      );
      if (info?.width)  width  = info.width;
      if (info?.height) height = info.height;
    } catch (err) {
      console.warn('[SpoutCanvasReceiver] start failed (will retry on poll):', err);
    }

    const state: ReceiverState = {
      senderName,
      width,
      height,
      active: true,
      rafId: null,
      inFlight: false,
      reuseBuf: null,
      latestFrame: null,
      errorLogCount: 0,
    };
    this.state = state;

    if (isElectron) this.startElectronPoll(state);
    else this.startTauriPoll(state);
  }

  /** Electron polling — IPC each rAF. */
  private startElectronPoll(state: ReceiverState): void {
    const tick = () => {
      if (!state.active) return;
      if (state.inFlight) {
        state.rafId = requestAnimationFrame(tick);
        return;
      }
      state.inFlight = true;
      invoke<{ data: ArrayBuffer; width: number; height: number } | null>('spout_receive_frame')
        .then((frame) => {
          state.inFlight = false;
          if (!state.active || !frame || !frame.data) {
            if (state.active) state.rafId = requestAnimationFrame(tick);
            return;
          }
          this.acceptFrame(state, frame.data, frame.width, frame.height);
          if (state.active) state.rafId = requestAnimationFrame(tick);
        })
        .catch((err) => {
          state.inFlight = false;
          if (state.errorLogCount < 3) {
            console.warn('[SpoutCanvasReceiver] IPC poll error:', err?.message || err);
            state.errorLogCount++;
          }
          if (state.active) state.rafId = requestAnimationFrame(tick);
        });
    };
    state.rafId = requestAnimationFrame(tick);
  }

  /** Tauri polling — HTTP GET against the local Rust worker. */
  private startTauriPoll(state: ReceiverState): void {
    const tick = async () => {
      if (!state.active) return;
      if (state.inFlight) { state.rafId = requestAnimationFrame(tick); return; }
      state.inFlight = true;
      try {
        const resp = await fetch(`http://127.0.0.1:9002/spout/receive/${encodeURIComponent(state.senderName)}`);
        if (resp.ok && resp.status !== 204) {
          const buf = await resp.arrayBuffer();
          this.acceptFrame(state, buf, state.width, state.height);
        }
      } catch (err) {
        if (state.errorLogCount < 3) {
          console.warn('[SpoutCanvasReceiver] HTTP poll error:', err);
          state.errorLogCount++;
        }
      } finally {
        state.inFlight = false;
      }
      if (state.active) state.rafId = requestAnimationFrame(tick);
    };
    state.rafId = requestAnimationFrame(tick);
  }

  /** Common path: stash the latest RGBA buffer for the consumer to
   *  pull on its next render tick. Reuses the Uint8Array across frames
   *  to avoid per-frame allocation churn. */
  private acceptFrame(state: ReceiverState, data: ArrayBuffer, w: number, h: number): void {
    const expected = w * h * 4;
    const src = new Uint8Array(data);
    if (src.byteLength !== expected) return; // size mismatch — drop

    if (!state.reuseBuf || state.reuseBuf.byteLength !== expected) {
      state.reuseBuf = new Uint8Array(expected);
    }
    state.reuseBuf.set(src);
    state.width = w;
    state.height = h;

    const prev = state.latestFrame;
    state.latestFrame = {
      data: state.reuseBuf,
      width: w,
      height: h,
      frameId: (prev?.frameId ?? 0) + 1,
    };
  }

  /** Stop the polling loop + tell the native side to release the
   *  receiver. Safe to call when already stopped. */
  stop(): void {
    const s = this.state;
    if (!s) return;
    s.active = false;
    if (s.rafId !== null) {
      cancelAnimationFrame(s.rafId);
      s.rafId = null;
    }
    invoke('spout_stop_receiver', { senderName: s.senderName }).catch(() => { /* */ });
    this.state = null;
  }

  dispose(): void { this.stop(); }
}
