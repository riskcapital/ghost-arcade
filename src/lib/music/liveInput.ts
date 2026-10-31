/**
 * The band inputs: instruments on audio inputs, played through the mixer
 * and listened to for notes that drive the visual voices.
 *
 * Each device is opened once, with the call-audio processing off, and split
 * into its channels: a stereo interface gives its two inputs as channels 1
 * and 2, so bass and guitar can come in on one device. Each band input hears
 * one channel (or the device's mix) and its signal goes two ways: into its
 * channel's strip (so it can be heard, EQ'd and sent like any instrument)
 * and, untouched by the strip, into an analyser its tracker reads. One timer
 * reads every input, off the frame loop, so hits land within about a
 * hundredth of a second whatever the frame rate.
 */

import { InputTracker, type TrackerEvent, type TrackerSettings } from './inputTracker';
import { MAX_DEVICE_CHANNELS, channelError, coarseLevel, groupInputsByDevice, idleInputStatus, sameStatus, type BandInputStatus } from './bandInputs';

const POLL_MS = 12;
/** The status lights refresh at most this often. */
const STATUS_MS = 100;
/** Samples each tracker reads; a bass needs a longer look for its low notes. */
const BLOCK = 2048;
const LOW_BLOCK = 4096;

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

/** What one band input listens to. */
export interface BandInputSpec {
  /** '' for the computer's default input. */
  deviceId: string;
  /** Channel of the device, from 0; -1 hears every channel mixed. */
  channel: number;
  /** 0-1: higher hears quieter playing. */
  sensitivity: number;
  /** Listen down to a bass's low notes. */
  low: boolean;
  /** False for a drum: hits only, no pitch looked for. */
  pitched?: boolean;
}

export interface LiveInputsHooks {
  /** Notes heard on an input. */
  onEvents: (index: number, events: TrackerEvent[]) => void;
  /** Any input's status changed (opened, failed, its level moved a step). */
  onStatus?: (status: BandInputStatus[]) => void;
}

/** A device opened for one or more inputs. */
interface Device {
  deviceId: string;
  /** Channels asked for. */
  channels: number;
  stream: MediaStream | null;
  source: MediaStreamAudioSourceNode | null;
  splitter: ChannelSplitterNode | null;
  /** Channels it sends, once open. */
  delivered: number | null;
  error: string | null;
  /** Waiting for the stream (its permission prompt may be up). */
  opening: boolean;
  /** Let go: a stream arriving after that is closed at once. */
  closed: boolean;
}

interface Wiring {
  device: Device;
  channel: number;
  low: boolean;
  into: AudioNode;
  /** The input's own signal: its channel of the device, or the device's mix. */
  tap: GainNode;
  analyser: AnalyserNode;
  buffer: Float32Array<ArrayBuffer>;
}

interface Input {
  spec: BandInputSpec;
  tracker: InputTracker;
  wiring: Wiring | null;
  error: string | null;
}

function openError(err: unknown): string {
  const name = (err as { name?: string })?.name;
  if (name === 'NotAllowedError') return 'Audio input was not allowed.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'That audio input is not connected.';
  return 'The audio input could not be opened.';
}

function trackerSettings(spec: BandInputSpec): TrackerSettings {
  return { sensitivity: spec.sensitivity, low: spec.low, pitched: spec.pitched !== false };
}

/** Channels a stream really sends, when the browser says. */
function deliveredChannels(stream: MediaStream): number | null {
  const settings = stream.getAudioTracks()[0]?.getSettings?.();
  const count = Number(settings?.channelCount);
  return Number.isFinite(count) && count > 0 ? Math.round(count) : null;
}

export class LiveInputs {
  private ctx: AudioContext | null = null;
  private devices = new Map<string, Device>();
  private inputs: Input[] = [];
  private into: (index: number) => AudioNode = () => { throw new Error('No strip'); };
  private timer: ReturnType<typeof setInterval> | null = null;
  private status: BandInputStatus[] = [];
  private lastStatusAt = 0;

  constructor(private readonly hooks: LiveInputsHooks) {}

  /** Some input is coming in. */
  get running(): boolean {
    return this.inputs.some((input) => input.wiring);
  }

  /** A device is still being opened (its permission prompt may be up). */
  get pending(): boolean {
    return [...this.devices.values()].some((device) => device.opening);
  }

  /** A device is open (even if no input on it hears its channel). */
  get open(): boolean {
    return [...this.devices.values()].some((device) => !!device.stream);
  }

  /** This input is coming in. */
  isOn(index: number): boolean {
    return !!this.inputs[index]?.wiring;
  }

  /** An input's level over its gate, 0-1, for its meter. */
  level(index: number): number {
    const input = this.inputs[index];
    return input?.wiring ? input.tracker.level : 0;
  }

  statuses(): BandInputStatus[] {
    return this.status;
  }

  /**
   * Open every input afresh (a device that failed is tried again). Resolves
   * once every device has opened or failed; a stop() or another start()
   * while it waits closes what arrives late.
   */
  async start(ctx: AudioContext, specs: readonly BandInputSpec[], into: (index: number) => AudioNode): Promise<void> {
    this.stop();
    await this.sync(ctx, specs, into);
  }

  /**
   * Follow the inputs as they are now: a device no input uses any more is
   * closed, a new one opened, an input whose device or channel moved is
   * rewired, and the rest keep playing untouched. A device that failed is
   * not tried again until an input on it changes device or start() is called.
   */
  async sync(ctx: AudioContext, specs: readonly BandInputSpec[], into: (index: number) => AudioNode): Promise<void> {
    if (this.ctx && this.ctx !== ctx) this.stop();
    this.ctx = ctx;
    this.into = into;
    // Inputs that went away let go of their notes.
    while (this.inputs.length > specs.length) this.dropInput(this.inputs.length - 1);
    specs.forEach((spec, i) => {
      const input = this.inputs[i];
      if (!input) {
        this.inputs.push({ spec: { ...spec }, tracker: new InputTracker(trackerSettings(spec)), wiring: null, error: null });
        return;
      }
      input.spec = { ...spec };
      input.tracker.setSettings(trackerSettings(spec));
    });
    const groups = groupInputsByDevice(specs, specs.map((s) => s.deviceId));
    // A device no input uses, or one asked for fewer channels than now needed, is let go.
    for (const [id, device] of this.devices) {
      const group = groups.find((g) => g.deviceId === id);
      const short = group && device.channels < group.channels && (device.delivered === null || device.delivered < group.channels);
      if (!group || (short && !device.error)) this.closeDevice(device);
    }
    const opens: Promise<void>[] = [];
    for (const group of groups) {
      if (!this.devices.has(group.deviceId)) opens.push(this.openDevice(ctx, group.deviceId, group.channels));
    }
    this.rewire();
    await Promise.all(opens);
  }

  /** Let every input go: streams closed, nodes disconnected, held notes ended. */
  stop(): void {
    for (const device of [...this.devices.values()]) this.closeDevice(device);
    while (this.inputs.length) this.dropInput(this.inputs.length - 1);
    this.stopTimer();
    this.ctx = null;
    this.publish(true);
  }

  private async openDevice(ctx: AudioContext, deviceId: string, channels: number): Promise<void> {
    const device: Device = { deviceId, channels, stream: null, source: null, splitter: null, delivered: null, error: null, opening: true, closed: false };
    this.devices.set(deviceId, device);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          channelCount: { ideal: channels },
          // An instrument wants its own sound: none of the call-audio processing.
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
    } catch (err) {
      device.opening = false;
      if (device.closed) return;
      device.error = openError(err);
      this.rewire();
      return;
    }
    device.opening = false;
    if (device.closed || this.ctx !== ctx) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    device.stream = stream;
    device.delivered = deliveredChannels(stream);
    try {
      device.source = ctx.createMediaStreamSource(stream);
      device.splitter = ctx.createChannelSplitter(Math.max(1, Math.min(MAX_DEVICE_CHANNELS, device.delivered ?? channels)));
      device.source.connect(device.splitter);
    } catch {
      this.releaseDevice(device);
      device.error = 'The audio input could not be opened.';
      this.rewire();
      return;
    }
    // A device unplugged mid-set ends its track.
    for (const track of stream.getAudioTracks()) track.addEventListener('ended', () => {
      if (device.closed || device.stream !== stream) return;
      this.releaseDevice(device);
      device.error = 'The audio input was disconnected.';
      this.rewire();
    });
    this.rewire();
  }

  /** Close a device and forget it (it is opened again when wanted). */
  private closeDevice(device: Device): void {
    device.closed = true;
    this.releaseDevice(device);
    if (this.devices.get(device.deviceId) === device) this.devices.delete(device.deviceId);
  }

  private releaseDevice(device: Device): void {
    for (const input of this.inputs) if (input.wiring?.device === device) this.unwire(input);
    try { device.source?.disconnect(); } catch { /* gone */ }
    try { device.splitter?.disconnect(); } catch { /* gone */ }
    device.stream?.getTracks().forEach((t) => t.stop());
    device.stream = null;
    device.source = null;
    device.splitter = null;
  }

  /** Wire every input to its device and strip as they are now; only what moved is touched. */
  private rewire(): void {
    const ctx = this.ctx;
    this.inputs.forEach((input, index) => {
      const device = this.devices.get(input.spec.deviceId) ?? null;
      // Not told how many channels the device sends, it has as many as were asked for.
      const error = device?.error ?? (device?.splitter ? channelError(input.spec.channel, device.splitter.numberOfOutputs) : null);
      input.error = error;
      const ready = !!ctx && !!device?.source && !error;
      if (!ready) {
        if (input.wiring) this.unwire(input);
        return;
      }
      const into = this.into(index);
      const w = input.wiring;
      if (w && w.device === device && w.channel === input.spec.channel && w.low === input.spec.low && w.into === into) return;
      if (w) this.unwire(input);
      this.wire(ctx!, input, device!, into);
    });
    if (this.running) this.startTimer();
    else this.stopTimer();
    this.publish(true);
  }

  private wire(ctx: AudioContext, input: Input, device: Device, into: AudioNode): void {
    const tap = ctx.createGain();
    const channel = input.spec.channel;
    // The mix keeps the device's channels as they are (a stereo source stays stereo); the analyser hears them summed.
    if (channel < 0) device.source!.connect(tap);
    else device.splitter!.connect(tap, channel);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = input.spec.low ? LOW_BLOCK : BLOCK;
    tap.connect(analyser);
    tap.connect(into);
    input.wiring = { device, channel, low: input.spec.low, into, tap, analyser, buffer: new Float32Array(analyser.fftSize) };
  }

  /** Take an input off its device and strip, ending its held note. */
  private unwire(input: Input): void {
    const w = input.wiring;
    if (!w) return;
    input.wiring = null;
    try {
      if (w.channel < 0) w.device.source?.disconnect(w.tap);
      else w.device.splitter?.disconnect(w.tap);
    } catch { /* gone */ }
    try { w.tap.disconnect(); } catch { /* gone */ }
    const index = this.inputs.indexOf(input);
    const released = input.tracker.reset();
    if (released.length && index >= 0) this.hooks.onEvents(index, released);
  }

  private dropInput(index: number): void {
    const input = this.inputs[index];
    if (!input) return;
    this.unwire(input);
    this.inputs.splice(index, 1);
  }

  private startTimer(): void {
    this.timer ??= setInterval(() => this.poll(), POLL_MS);
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private poll(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const time = ctx.currentTime;
    this.inputs.forEach((input, index) => {
      const w = input.wiring;
      if (!w) return;
      w.analyser.getFloatTimeDomainData(w.buffer);
      const events = input.tracker.step(w.buffer, ctx.sampleRate, time);
      if (events.length) this.hooks.onEvents(index, events);
    });
    this.publish(false);
  }

  /** Tell the studio how every input is doing; level moves only every so often. */
  private publish(now: boolean): void {
    const at = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (!now && at - this.lastStatusAt < STATUS_MS) return;
    // Checked again a while from now even when nothing moved (not on every poll).
    this.lastStatusAt = at;
    const next = this.inputs.map((input): BandInputStatus => ({
      ...idleInputStatus(),
      on: !!input.wiring,
      error: input.error,
      level: input.wiring ? coarseLevel(input.tracker.level) : 0,
      channels: this.devices.get(input.spec.deviceId)?.delivered ?? null,
    }));
    if (sameStatus(next, this.status)) return;
    this.status = next;
    this.hooks.onStatus?.(next);
  }
}
