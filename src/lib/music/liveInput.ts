/**
 * The live input: an instrument on an audio input, played through the mixer
 * and listened to for notes that drive the visual voices.
 *
 * The signal goes two ways: into the input channel's strip (so it can be
 * heard, EQ'd and sent like any instrument) and, untouched by the strip,
 * into an analyser the tracker reads. The tracker runs on its own timer
 * rather than the frame loop, so hits land within about a hundredth of a
 * second whatever the frame rate.
 */

import { InputTracker, type TrackerEvent } from './inputTracker';

const POLL_MS = 12;

export interface AudioInputDevice {
  id: string;
  label: string;
}

/** Audio inputs on this computer. Labels only show once an input has been allowed. */
export async function listAudioInputs(): Promise<AudioInputDevice[]> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return [];
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications')
      .map((d, i) => ({ id: d.deviceId, label: d.label || `Input ${i + 1}` }));
  } catch {
    return [];
  }
}

export class LiveInput {
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private buffer: Float32Array<ArrayBuffer> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private ctx: AudioContext | null = null;
  private readonly tracker: InputTracker;

  constructor(
    sensitivity: number,
    private readonly onEvents: (events: TrackerEvent[]) => void,
    /** The device went away (unplugged) without `stop()` being called. */
    private readonly onLost: () => void = () => {},
  ) {
    this.tracker = new InputTracker({ sensitivity });
  }

  get running(): boolean {
    return !!this.stream;
  }

  /** Level over the gate, 0-1, for the input's meter. */
  get level(): number {
    return this.running ? this.tracker.level : 0;
  }

  setSensitivity(sensitivity: number): void {
    this.tracker.setSettings({ sensitivity });
  }

  /** Open `deviceId` ('' for the default input) into `into`. Throws with a readable message. */
  async start(ctx: AudioContext, deviceId: string, into: AudioNode): Promise<void> {
    this.stop();
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          // An instrument wants its own sound: none of the call-audio processing.
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
    } catch (err) {
      const name = (err as { name?: string })?.name;
      if (name === 'NotAllowedError') throw new Error('Audio input was not allowed.');
      if (name === 'NotFoundError' || name === 'OverconstrainedError') throw new Error('That audio input is not connected.');
      throw new Error('The audio input could not be opened.');
    }
    this.ctx = ctx;
    this.stream = stream;
    this.source = ctx.createMediaStreamSource(stream);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.buffer = new Float32Array(this.analyser.fftSize);
    this.source.connect(this.analyser);
    this.source.connect(into);
    // A device unplugged mid-set ends its track.
    for (const track of stream.getAudioTracks()) track.addEventListener('ended', () => {
      if (this.stream !== stream) return;
      this.stop();
      this.onLost();
    });
    this.timer = setInterval(() => this.poll(), POLL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    try { this.source?.disconnect(); } catch { /* gone */ }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.source = null;
    this.analyser = null;
    const released = this.tracker.reset();
    if (released.length) this.onEvents(released);
  }

  private poll(): void {
    if (!this.analyser || !this.buffer || !this.ctx) return;
    this.analyser.getFloatTimeDomainData(this.buffer);
    const time = this.ctx.currentTime;
    const events = this.tracker.step(this.buffer, this.ctx.sampleRate, time);
    if (events.length) this.onEvents(events);
  }
}
