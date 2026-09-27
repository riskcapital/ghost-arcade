/**
 * Clip audio drives audio reactivity when no live input is running.
 *
 * Looks, ISF audio inputs and audio modulation all read the analyser, which
 * used to exist only while a mic / system / file input ran, so a VJ playing
 * clips with sound got no reactivity at all. This controller starts the
 * analyser in its clip-follow mode whenever the app itself is making sound:
 *
 *  - the WebAudio clip bus (MIX layers, show timeline tracks) connects its
 *    master into the follow analyser (clipAudioBus.wireMasterOutputs);
 *  - the native VJ clip mix (desktop, played by the core) is streamed back
 *    from the core's post-mix analysis scope and scheduled into the same
 *    analyser. It is never connected to the speakers: the core plays it.
 *
 * A live input always wins. Starting one replaces the follow analyser, and
 * stopping it hands reactivity back to the clips.
 */
import { audioStore, type AudioState } from '../stores/audio';
import { clipAudioMaster, type ClipAudioMasterState } from './clipAudioBus';
import { nativeClipAudioAudible } from './nativeClipAudio';
import { audioAnalyzer } from './analyzer';
import { readNativeAudioScope } from '../api/native-renderer';
import { isDesktopApp } from '../bridge';

/** Poll period for the core's scope; each read returns everything since the last. */
const SCOPE_POLL_MS = 25;
/** Scheduling lead: absorbs IPC jitter between polls. */
const SCHEDULE_LEAD_SECONDS = 0.05;
/** Past this much queued audio the feed resynchronises instead of lagging. */
const MAX_QUEUED_SECONDS = 0.3;

export function decodeScopeSamples(base64: string): Float32Array<ArrayBuffer> {
  if (!base64) return new Float32Array(0);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length - (binary.length % 4));
  for (let i = 0; i < bytes.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

/** Streams the core's clip mix into the follow analyser (analysis only). */
class NativeClipAudioFeed {
  private timer: ReturnType<typeof setInterval> | null = null;
  private next: number | null = null;
  private inFlight = false;
  private playhead = 0;

  get running() { return this.timer !== null; }

  start() {
    if (this.timer) return;
    this.next = null;
    this.playhead = 0;
    this.timer = setInterval(() => { void this.poll(); }, SCOPE_POLL_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.next = null;
  }

  private async poll() {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      // The first read only learns the current position: audio from before
      // the feed started is stale.
      const scope = await readNativeAudioScope(this.next ?? Number.MAX_SAFE_INTEGER, 4096);
      if (!this.timer) return;
      const first = this.next === null;
      this.next = scope.next;
      if (first || scope.frames <= 0) return;
      const analyser = audioAnalyzer.clipAudioAnalyserNode();
      if (!analyser) return;
      const samples = decodeScopeSamples(scope.samples_b64);
      if (samples.length === 0) return;
      const ctx = analyser.context as AudioContext;
      const buffer = ctx.createBuffer(1, samples.length, scope.rate || 48000);
      buffer.copyToChannel(samples, 0);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(analyser);
      const now = ctx.currentTime;
      let when = Math.max(now + SCHEDULE_LEAD_SECONDS, this.playhead);
      if (when - now > MAX_QUEUED_SECONDS) when = now + SCHEDULE_LEAD_SECONDS;
      source.start(when);
      source.onended = () => { try { source.disconnect(); } catch { /* already gone */ } };
      this.playhead = when + buffer.duration;
    } catch {
      // Core not running yet, or restarting: try again on the next tick.
      this.next = null;
    } finally {
      this.inFlight = false;
    }
  }
}

const nativeFeed = new NativeClipAudioFeed();
let audio: AudioState | null = null;
let bus: ClipAudioMasterState | null = null;
let nativeAudible = false;

function evaluate() {
  if (!audio || !bus) return;
  const busAudible = bus.activeClips > 0 && !bus.exportSilenced;
  const want = busAudible || nativeAudible;
  if (want && audio.inputType === 'none') audioStore.startClipFollow();
  else if (!want && audio.inputType === 'clips') void audioStore.stopClipFollow();
  const feedNative = isDesktopApp && nativeAudible && audio.inputType === 'clips';
  if (feedNative && !nativeFeed.running) nativeFeed.start();
  else if (!feedNative && nativeFeed.running) nativeFeed.stop();
}

if (typeof window !== 'undefined') {
  audioStore.subscribe(state => {
    const changed = !audio || audio.inputType !== state.inputType;
    audio = state;
    if (changed) evaluate();
  });
  clipAudioMaster.subscribe(state => { bus = state; evaluate(); });
  nativeClipAudioAudible.subscribe(value => { nativeAudible = value; evaluate(); });
}
