/**
 * The band's inputs: which audio device each one opens and which of its
 * channels it hears, how each is doing, and where its notes go.
 *
 * Several inputs can share a device (bass and guitar on the two inputs of a
 * stereo interface): the device is opened once and split into its channels.
 * Pure, so it can be tested without Web Audio.
 */

import type { LiveInputSettings } from './mixer';
import type { VoiceSourceId } from './visualVoices';

/** Channels a device can be asked for. */
export const MAX_DEVICE_CHANNELS = 32;

/** One audio device, opened once for every band input on it. */
export interface DeviceGroup {
  /** '' for the computer's default input. */
  deviceId: string;
  /** The band inputs it feeds, by index. */
  inputs: number[];
  /** Channels to ask the device for: enough for the highest channel heard. */
  channels: number;
}

/**
 * The devices to open for a set of inputs, in the order they first appear.
 * A mixed input asks for two channels, so a stereo interface's mix has both
 * sides in it; a device with fewer gives what it has.
 */
export function groupInputsByDevice(inputs: readonly Pick<LiveInputSettings, 'channel'>[], devices: readonly string[]): DeviceGroup[] {
  const groups = new Map<string, DeviceGroup>();
  inputs.forEach((input, index) => {
    const deviceId = devices[index] ?? '';
    let group = groups.get(deviceId);
    if (!group) {
      group = { deviceId, inputs: [], channels: 1 };
      groups.set(deviceId, group);
    }
    group.inputs.push(index);
    const wanted = input.channel >= 0 ? input.channel + 1 : 2;
    group.channels = Math.min(MAX_DEVICE_CHANNELS, Math.max(group.channels, wanted));
  });
  return [...groups.values()];
}

/** Why an input hears nothing on its channel, or null when the device sends it. */
export function channelError(channel: number, delivered: number): string | null {
  if (channel < 0 || channel < delivered) return null;
  if (delivered <= 1) return `This device sends one channel. Choose Mix or 1.`;
  return `This device sends ${delivered} channels. Choose Mix or 1 to ${delivered}.`;
}

/**
 * The channel choices for an input: Mix, then each channel of its device.
 * Before the device is open its channel count is not known, so a stereo
 * pair is offered; a channel already chosen always stays in the list.
 */
export function channelChoices(delivered: number | null, current: number): number[] {
  const count = Math.min(MAX_DEVICE_CHANNELS, Math.max(delivered ?? 2, current + 1, 1));
  return [-1, ...Array.from({ length: count }, (_, i) => i)];
}

/** "Mix", "1", "2"... */
export function channelLabel(channel: number): string {
  return channel < 0 ? 'Mix' : String(channel + 1);
}

/** How one band input is doing, for its light and its error. */
export interface BandInputStatus {
  /** Its channel is coming in. */
  on: boolean;
  /** Why it could not open, in plain words. */
  error: string | null;
  /** Level over its gate, 0-1, in coarse steps: for a light, not a meter. */
  level: number;
  /** Channels its device sends, once open. */
  channels: number | null;
}

export function idleInputStatus(): BandInputStatus {
  return { on: false, error: null, level: 0, channels: null };
}

/** The status lights only move when a level changes by a step this big. */
export const STATUS_LEVEL_STEP = 0.05;

export function coarseLevel(level: number): number {
  return Math.round(Math.max(0, Math.min(1, level)) / STATUS_LEVEL_STEP) * STATUS_LEVEL_STEP;
}

export function sameStatus(a: readonly BandInputStatus[], b: readonly BandInputStatus[]): boolean {
  return a.length === b.length && a.every((x, i) => {
    const y = b[i];
    return x.on === y.on && x.error === y.error && x.level === y.level && x.channels === y.channels;
  });
}

/**
 * The studio's one listening light from every input's: on while any input
 * comes in; the first error, named after its input when there are several.
 */
export function overallInputStatus(statuses: readonly BandInputStatus[], inputs: readonly Pick<LiveInputSettings, 'name'>[]): { on: boolean; error: string | null } {
  const on = statuses.some((s) => s.on);
  const index = statuses.findIndex((s) => s.error);
  if (index < 0) return { on, error: null };
  const error = statuses[index].error!;
  if (inputs.length <= 1) return { on, error };
  return { on, error: `${inputs[index]?.name || `Input ${index + 1}`}: ${error}` };
}

/**
 * Remembers which role each sounding input note was started as, so its end
 * reaches the same visual voices even if the input's role changed, or the
 * input moved up a place, while it was held.
 */
export class InputNoteRoles {
  private held = new Map<string, VoiceSourceId>();

  /** The role this event goes to; `role` is the input's role now. */
  route(index: number, type: 'on' | 'off', note: number, role: VoiceSourceId): VoiceSourceId {
    const key = `${index}:${note}`;
    if (type === 'on') {
      this.held.set(key, role);
      return role;
    }
    const started = this.held.get(key);
    this.held.delete(key);
    return started ?? role;
  }

  clear(): void {
    this.held.clear();
  }

  get size(): number {
    return this.held.size;
  }
}
