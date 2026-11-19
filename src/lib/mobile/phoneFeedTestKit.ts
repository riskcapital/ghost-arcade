/* Fakes for the phone feed tests: frames, a frame source, a core and a WebRTC peer. */
import type { PhoneFeedBlankCommand, PhoneFeedUploadCommand, PumpFrame, PumpFrameSource, PumpSink } from './phoneFeedPump';

export type FakeFrame = PumpFrame & { closed: boolean; copies: number };

export function fakeFrame(width = 64, height = 32, meta?: { captureTime?: number; receiveTime?: number }): FakeFrame {
  const frame: FakeFrame = {
    displayWidth: width,
    displayHeight: height,
    timestamp: 0,
    closed: false,
    copies: 0,
    async copyTo(destination: Uint8Array, options?: { format?: string }) {
      if (frame.closed) throw new Error('closed frame');
      if (options?.format !== 'RGBA') throw new Error('expected an RGBA copy');
      if (destination.byteLength !== width * height * 4) throw new Error('wrong destination size');
      frame.copies += 1;
      destination.fill(200);
      return [];
    },
    close() { frame.closed = true; },
    metadata: () => meta ?? {},
  };
  return frame;
}

/** Frames pushed by the test, read by the pump. */
export function fakeFrameSource() {
  const queue: (PumpFrame | null)[] = [];
  let waiting: ((frame: PumpFrame | null) => void) | null = null;
  let cancelled = false;
  const source: PumpFrameSource & { push(frame: PumpFrame | null): void; cancelled: () => boolean } = {
    read() {
      if (cancelled) return Promise.resolve(null);
      const next = queue.shift();
      if (next !== undefined) return Promise.resolve(next);
      return new Promise((resolve) => { waiting = resolve; });
    },
    cancel() { cancelled = true; waiting?.(null); waiting = null; },
    push(frame) {
      if (waiting) { const w = waiting; waiting = null; w(frame); } else queue.push(frame);
    },
    cancelled: () => cancelled,
  };
  return source;
}

/** A render core: takes uploads (optionally held until released), and says whether a source has a frame. */
export function fakeCore() {
  const uploads: (PhoneFeedUploadCommand | PhoneFeedBlankCommand)[] = [];
  let hold: (() => void)[] | null = null;
  let accept = true;
  const shownIds = new Set<string>();
  const sink: PumpSink = {
    upload(command) {
      // The IPC clone happens at send time: keep a snapshot, as the core would get.
      uploads.push('rgba_buffer' in command ? { ...command, rgba_buffer: new Uint8Array(command.rgba_buffer) } : { ...command });
      if (accept && command.width > 2) shownIds.add(command.source_id);
      if (accept && command.width <= 2) shownIds.delete(command.source_id);
      if (!hold) return Promise.resolve(accept);
      return new Promise((resolve) => hold!.push(() => resolve(accept)));
    },
    shown: async (id) => shownIds.has(id),
  };
  return {
    sink,
    uploads,
    holdUploads() { hold = []; },
    releaseUploads() { const pending = hold ?? []; hold = null; pending.forEach((r) => r()); },
    refuse() { accept = false; },
  };
}

export const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Enough of RTCPeerConnection for the receiver. */
export class FakePeer {
  static made: FakePeer[] = [];
  connectionState: RTCPeerConnectionState = 'new';
  remoteDescription: RTCSessionDescriptionInit | null = null;
  localDescription: RTCSessionDescriptionInit | null = null;
  closed = false;
  candidates: RTCIceCandidateInit[] = [];
  onicecandidate: ((event: any) => void) | null = null;
  ontrack: ((event: any) => void) | null = null;
  ondatachannel: ((event: any) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  constructor() { FakePeer.made.push(this); }
  async setRemoteDescription(sdp: RTCSessionDescriptionInit) { await Promise.resolve(); this.remoteDescription = sdp; }
  async createAnswer() { return { type: 'answer', sdp: 'answer-sdp' } as RTCSessionDescriptionInit; }
  async setLocalDescription(sdp: RTCSessionDescriptionInit) { this.localDescription = sdp; }
  async addIceCandidate(candidate: RTCIceCandidateInit) { this.candidates.push(candidate); }
  close() { this.closed = true; this.connectionState = 'closed'; }
  setState(state: RTCPeerConnectionState) { this.connectionState = state; this.onconnectionstatechange?.(); }
  /** The phone's video track arrives. */
  addTrack() {
    const track = { kind: 'video', stopped: false, stop() { this.stopped = true; } };
    this.ontrack?.({ track, streams: [] });
    return track;
  }
}
