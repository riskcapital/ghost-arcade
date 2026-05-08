/**
 * outputPixelBroadcast — editor-side WebRTC peer that publishes the
 * main canvas as a video stream to the output window.
 *
 * Architectural goal: get as close as we can to the pro VJ-app pattern
 * (Resolume, TouchDesigner, VDMX) inside Electron's process model. The
 * pros run ONE rendering pipeline and present its frames to multiple
 * display surfaces via OS-level GPU-shared resources. Electron's
 * cross-process model rules that out without native code, but
 * `canvas.captureStream()` + same-process WebRTC gets us 90% of the
 * way there with browser-native APIs:
 *
 *   - One renderer (editor's main canvas) — same as the pros
 *   - Output is presentation-only: a single `<video srcObject>` element
 *     in the output window — same as the pros
 *   - Same-process Chromium WebRTC short-circuits encode/decode when
 *     source and destination are in-process; latency is sub-frame and
 *     CPU cost is low. Not as fast as native shared-texture but no
 *     platform code, no native addon, ships clean
 *
 * Signaling channel: `ghostarcade-output-pixels` (a BroadcastChannel
 * separate from the existing `ghostarcade-state-sync` so concerns stay
 * isolated). Messages:
 *
 *   { type: 'ready', from: 'output' }                  — output is alive, please offer
 *   { type: 'offer', from: 'editor', sdp: ... }        — editor offers
 *   { type: 'answer', from: 'output', sdp: ... }       — output accepts
 *   { type: 'ice', from: '...', candidate: ... }       — trickled ICE
 *   { type: 'transform', from: 'editor', payload: ... } — output transform deltas
 *   { type: 'bye', from: 'output' }                    — output is shutting down
 *
 * The transform messages carry the subset of settings.output the
 * presentation surface needs: rotation, brightness, contrast, fit
 * policy. The output window applies them as CSS on the `<video>`
 * element (gamma + crop intentionally TODO — gamma can't be done in
 * pure CSS, crop needs a math pass we haven't written yet). Without
 * these the WebRTC view delivers raw editor pixels and the user's
 * Settings → Output → Rotation/etc are ignored — Codex caught this
 * gap in the v1 prototype review.
 *
 * Resilience:
 *   - The output sends `ready` with a 2 s heartbeat until `connected`,
 *     so we tolerate output-mounts-before-editor-listens, mid-session
 *     flag toggles, and peer drops. Our handler treats repeated
 *     `ready` idempotently — only rebuilds the peer when none exists
 *     OR the existing one isn't `connected`.
 *   - ICE candidates that arrive before setRemoteDescription resolves
 *     are queued and drained when the remote description is set.
 *
 * Same-origin same-process WebRTC needs no STUN / TURN servers; ICE
 * resolves to host candidates that route directly. RTCPeerConnection
 * with no `iceServers` config is the fast path.
 *
 * Flag-gated: this module is started only when
 *   - settings.experimental.outputWebRTC is true
 *   - this is NOT the output / OSR window itself (we don't broadcast
 *     to ourselves)
 * The legacy `?mode=output` SpoutOutputApp path stays the production
 * default until the success-criteria sweep lands clean on real
 * hardware.
 */

import { get } from 'svelte/store';
import { settings } from '$lib/stores/settings';

const SIGNAL_CHANNEL = 'ghostarcade-output-pixels';

let pc: RTCPeerConnection | null = null;
let stream: MediaStream | null = null;
let channel: BroadcastChannel | null = null;
let sourceCanvas: HTMLCanvasElement | null = null;
let captureFrameRate = 60;

// ICE candidate queue — same rationale as on the receiver side.
// addIceCandidate throws if called before setRemoteDescription
// resolves; the offer side rarely hits this since we send the offer
// before the receiver replies, but signaling can race in unexpected
// ways (stale receiver, BroadcastChannel reordering on slow tabs).
const pendingIceCandidates: RTCIceCandidateInit[] = [];
let remoteDescriptionSet = false;

// Settings reactive subscription — pushes transform deltas to the
// receiver whenever output rotation / brightness / contrast / fit
// changes. Set in startOutputPixelBroadcast, cleared in stop.
let settingsUnsub: (() => void) | null = null;

/** Set up the broadcaster. Idempotent — calling multiple times with
 *  the same canvas is a no-op; calling with a different canvas tears
 *  down the previous peer first. */
export function startOutputPixelBroadcast(canvas: HTMLCanvasElement, frameRate = 60): void {
  if (sourceCanvas === canvas && channel) return;
  if (sourceCanvas !== canvas) stopOutputPixelBroadcast();

  sourceCanvas = canvas;
  captureFrameRate = frameRate;

  try {
    channel = new BroadcastChannel(SIGNAL_CHANNEL);
  } catch (e) {
    console.warn('[OutputPixelBroadcast] BroadcastChannel unavailable:', e);
    return;
  }

  channel.onmessage = async (event) => {
    const msg = event.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.from === 'editor') return; // loopback guard

    try {
      if (msg.type === 'ready') {
        await handleReadyFromOutput();
      } else if (msg.type === 'answer' && pc) {
        await pc.setRemoteDescription(msg.sdp);
        remoteDescriptionSet = true;
        await drainIceQueue();
        console.log('[OutputPixelBroadcast] answer received, peer should connect');
      } else if (msg.type === 'ice' && msg.candidate) {
        await applyIceCandidate(msg.candidate);
      } else if (msg.type === 'bye') {
        teardownPeer();
      }
    } catch (e: any) {
      console.error('[OutputPixelBroadcast] signaling error:', e?.message ?? e);
    }
  };

  // Push the current transform snapshot every time output settings
  // change. The receiver applies them as CSS on its <video>. Initial
  // emission happens immediately so the first frame the receiver
  // shows is already correctly transformed.
  let lastTransformJson = '';
  const sendTransformIfChanged = (s: any) => {
    if (!channel) return;
    const payload = {
      rotation: s.output?.outputRotation ?? 0,
      brightness: s.output?.brightness ?? 1,
      contrast: s.output?.contrast ?? 1,
      // Default fit: 'cover' so the projector fills the surface
      // without letterbox by default. The legacy renderer stretched;
      // we expose this as a settable option so users can pick.
      fit: (s.output as any)?.outputFit ?? 'cover',
    };
    const json = JSON.stringify(payload);
    if (json === lastTransformJson) return;
    lastTransformJson = json;
    try {
      channel.postMessage({ type: 'transform', from: 'editor', payload });
    } catch { /* */ }
  };
  // Initial push now (synchronous get) so the value is present even
  // before the subscription's first delivery.
  sendTransformIfChanged(get(settings));
  settingsUnsub = settings.subscribe(sendTransformIfChanged);

  console.log(`[OutputPixelBroadcast] editor-side peer ready, listening on "${SIGNAL_CHANNEL}"`);
}

/** Tear down everything. Called on Canvas onDestroy or when the user
 *  toggles the experimental flag off. */
export function stopOutputPixelBroadcast(): void {
  teardownPeer();
  if (settingsUnsub) {
    try { settingsUnsub(); } catch { /* */ }
    settingsUnsub = null;
  }
  if (channel) {
    try { channel.close(); } catch { /* */ }
    channel = null;
  }
  sourceCanvas = null;
}

function teardownPeer(): void {
  if (pc) {
    try { pc.close(); } catch { /* */ }
    pc = null;
  }
  if (stream) {
    try { stream.getTracks().forEach((t) => t.stop()); } catch { /* */ }
    stream = null;
  }
  pendingIceCandidates.length = 0;
  remoteDescriptionSet = false;
}

async function applyIceCandidate(candidate: RTCIceCandidateInit) {
  if (!pc) return;
  if (!remoteDescriptionSet) {
    pendingIceCandidates.push(candidate);
    return;
  }
  try {
    await pc.addIceCandidate(candidate);
  } catch (e: any) {
    console.warn('[OutputPixelBroadcast] addIceCandidate failed:', e?.message ?? e);
  }
}

async function drainIceQueue() {
  if (!pc) return;
  while (pendingIceCandidates.length) {
    const c = pendingIceCandidates.shift();
    if (c) {
      try {
        await pc.addIceCandidate(c);
      } catch (e: any) {
        console.warn('[OutputPixelBroadcast] queued addIceCandidate failed:', e?.message ?? e);
      }
    }
  }
}

/** Output window has come online and asked for a stream. Build a
 *  fresh peer ONLY if we don't have a connected one already — repeated
 *  `ready` messages from the heartbeat are normal and idempotent. */
async function handleReadyFromOutput(): Promise<void> {
  if (!sourceCanvas || !channel) return;

  // Idempotent: a connected peer means the output is already getting
  // frames; the heartbeat is just keep-alive. Ignore. If we have a
  // peer in any other state (new, connecting, disconnected, failed,
  // closed) tear it down and rebuild — better to start clean than
  // chase intermediate states.
  if (pc && pc.connectionState === 'connected') return;

  console.log('[OutputPixelBroadcast] output window ready — building peer + capturing canvas');
  teardownPeer();

  pc = new RTCPeerConnection();

  pc.onicecandidate = (event) => {
    if (event.candidate && channel) {
      channel.postMessage({ type: 'ice', from: 'editor', candidate: event.candidate.toJSON() });
    }
  };

  pc.onconnectionstatechange = () => {
    console.log('[OutputPixelBroadcast] peer connection state:', pc?.connectionState);
    if (pc?.connectionState === 'failed') {
      teardownPeer();
    }
    // 'disconnected' may recover on its own — leave it alone. The
    // receiver's heartbeat will trigger a fresh build if needed.
  };

  // Capture the editor canvas as a MediaStream. captureStream's
  // frameRate hint asks the browser to emit at most that rate; the
  // canvas's actual paint rate caps it from above.
  stream = sourceCanvas.captureStream(captureFrameRate);
  const videoTracks = stream.getVideoTracks();
  if (videoTracks.length === 0) {
    console.error('[OutputPixelBroadcast] canvas.captureStream returned no video tracks');
    teardownPeer();
    return;
  }

  const senders: RTCRtpSender[] = [];
  for (const track of videoTracks) {
    senders.push(pc.addTrack(track, stream));
  }

  // Tune the sender for our specific workload: same-process loopback,
  // local network, no bandwidth concerns, want max visual quality.
  // Default WebRTC settings target a generic videoconference and scale
  // down under load — that's what was making the WebRTC output look
  // noticeably worse than the legacy renderer at smaller window sizes.
  //
  //   - maxBitrate 80 Mbps: well above what any practical content
  //     needs, lets the encoder run close to lossless. Same-process
  //     transit so the bitrate doesn't go on a wire.
  //   - degradationPreference 'maintain-resolution': if the encoder
  //     can't keep up, drop fps before scale, never the other way.
  //   - scaleResolutionDownBy 1.0: hard floor, no auto-scaling.
  //   - networkPriority 'high': ask the OS scheduler to prioritise
  //     the loopback datapath.
  for (const sender of senders) {
    try {
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }
      for (const enc of params.encodings) {
        enc.maxBitrate = 80_000_000;
        enc.scaleResolutionDownBy = 1.0;
        (enc as any).networkPriority = 'high';
      }
      // 'degradationPreference' is a sender-level field, not per-encoding.
      (params as any).degradationPreference = 'maintain-resolution';
      await sender.setParameters(params);
    } catch (e: any) {
      console.warn('[OutputPixelBroadcast] sender.setParameters failed (proceeding with defaults):', e?.message ?? e);
    }
  }

  // SDP offer/answer exchange. After SDP is negotiated, optionally
  // swap codec preferences to VP9 / AV1 (higher quality at same
  // bitrate than VP8). Done before createOffer so the offer carries
  // the preference.
  try {
    const transceivers = pc.getTransceivers();
    const supported = (RTCRtpSender as any).getCapabilities?.('video')?.codecs ?? [];
    if (supported.length) {
      // Preferred order: VP9 > AV1 > H.264 > VP8. AV1 has the best
      // quality/bitrate ratio but encode cost is higher; VP9 is the
      // sweet spot for same-process where bitrate is free anyway.
      const order = ['video/VP9', 'video/AV1', 'video/H264', 'video/VP8'];
      const preferred = order
        .map((mt) => supported.find((c: any) => c.mimeType === mt))
        .filter(Boolean);
      const rest = supported.filter((c: any) => !preferred.includes(c));
      const codecOrder = [...preferred, ...rest];
      for (const t of transceivers) {
        if (t.sender && t.sender.track && t.sender.track.kind === 'video') {
          try { (t as any).setCodecPreferences(codecOrder); } catch { /* spec-optional */ }
        }
      }
    }
  } catch (e: any) {
    console.warn('[OutputPixelBroadcast] codec preference setup failed (proceeding with default):', e?.message ?? e);
  }

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  channel.postMessage({ type: 'offer', from: 'editor', sdp: offer });
}

/** Diagnostics readout. Used by the future dev preferences panel. */
export function getOutputPixelBroadcastState(): {
  active: boolean;
  connectionState: RTCPeerConnectionState | null;
  trackCount: number;
} {
  return {
    active: !!pc,
    connectionState: pc?.connectionState ?? null,
    trackCount: stream?.getVideoTracks().length ?? 0,
  };
}
