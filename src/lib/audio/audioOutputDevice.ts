/**
 * Which sound card the show audio plays on.
 *
 * Show tracks play through the app's shared AudioContext (the clip audio
 * bus), so the choice is that context's output device
 * (`AudioContext.setSinkId`). It is saved on this computer and applied when
 * the audio engine starts. When the chosen device is unplugged, audio falls
 * back to the system default and the choice is kept, so it comes back when
 * the device does.
 */
import { writable, get } from 'svelte/store';
import { audioAnalyzer } from './analyzer';

export const AUDIO_OUTPUT_STORAGE_KEY = 'ghost-show-audio-output';

export interface AudioOutputDevice {
  deviceId: string;
  label: string;
}

export interface AudioOutputState {
  /** Saved choice; '' is the system default. */
  deviceId: string;
  devices: AudioOutputDevice[];
  /** The saved device is not connected; audio plays on the default. */
  missing: boolean;
  error: string | null;
  /** False where the runtime cannot pick an output at all. */
  supported: boolean;
}

/**
 * The sink to apply for a saved choice, given the devices present. An
 * empty list means the devices are not known yet: try the saved one.
 */
export function resolveAudioSink(saved: string | null | undefined, available: AudioOutputDevice[]): { sinkId: string; missing: boolean } {
  const id = saved && saved !== 'default' ? saved : '';
  if (!id) return { sinkId: '', missing: false };
  if (available.length === 0 || available.some((d) => d.deviceId === id)) return { sinkId: id, missing: false };
  return { sinkId: '', missing: true };
}

/** Output devices from `enumerateDevices`, without the browser's own "default" and "communications" entries. */
export function audioOutputsFrom(devices: Array<{ kind: string; deviceId: string; label: string }>): AudioOutputDevice[] {
  const outputs = devices.filter((d) => d.kind === 'audiooutput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications');
  return outputs.map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Output ${i + 1}` }));
}

function loadSaved(): string {
  try {
    return globalThis.localStorage?.getItem(AUDIO_OUTPUT_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function save(deviceId: string): void {
  try {
    if (deviceId) globalThis.localStorage?.setItem(AUDIO_OUTPUT_STORAGE_KEY, deviceId);
    else globalThis.localStorage?.removeItem(AUDIO_OUTPUT_STORAGE_KEY);
  } catch {
    /* private mode: the choice lasts the session */
  }
}

function runtimeSupportsSink(): boolean {
  const Ctx = (globalThis as any).AudioContext;
  return !!Ctx && typeof Ctx.prototype?.setSinkId === 'function';
}

export const audioOutput = writable<AudioOutputState>({
  deviceId: loadSaved(),
  devices: [],
  missing: false,
  error: null,
  supported: runtimeSupportsSink(),
});

let started = false;

async function listDevices(): Promise<AudioOutputDevice[]> {
  try {
    const all = await navigator.mediaDevices?.enumerateDevices?.();
    return audioOutputsFrom(all ?? []);
  } catch {
    return [];
  }
}

async function apply(): Promise<void> {
  const state = get(audioOutput);
  if (!state.supported) return;
  const { sinkId, missing } = resolveAudioSink(state.deviceId, state.devices);
  const error = await audioAnalyzer.setOutputSink(sinkId);
  audioOutput.update((s) => ({ ...s, missing, error }));
}

/** Read the device list again, then apply the saved choice to it. */
export async function refreshAudioOutputs(): Promise<void> {
  const devices = await listDevices();
  audioOutput.update((s) => ({ ...s, devices }));
  await apply();
}

/** Choose the output; '' is the system default. Saved on this computer. */
export async function selectAudioOutput(deviceId: string): Promise<void> {
  const id = deviceId === 'default' ? '' : deviceId;
  save(id);
  audioOutput.update((s) => ({ ...s, deviceId: id }));
  await apply();
}

/** Apply the saved choice and follow devices being plugged in and out. Safe to call more than once. */
export function startAudioOutputSelection(): void {
  if (started || typeof navigator === 'undefined') return;
  started = true;
  void refreshAudioOutputs();
  try {
    navigator.mediaDevices?.addEventListener?.('devicechange', () => { void refreshAudioOutputs(); });
  } catch {
    /* no device events here */
  }
}
