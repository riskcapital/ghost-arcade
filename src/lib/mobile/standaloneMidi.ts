// Mobile-standalone MIDI input via Web MIDI API.
//
// Works on Chrome-based Android WebViews (Capacitor) and desktop Chrome
// (for the dev server). iOS Safari/WebKit does not implement Web MIDI yet,
// so on iOS this module exits early in its `status` getter; an iOS native
// Capacitor MIDI bridge can land later behind the same interface.
//
// Mappings are stored as `MidiTarget → MidiBinding` pairs. Targets are
// the VJ controls we expose:
//   - 'crossfader'                    — CC value 0..127 → 0..1
//   - `bank:0`..`bank:3`              — note-on → select that bank
//   - `clip:0`..`clip:8`              — note-on → launch clip in current bank
//   - 'micToggle'                     — note-on → toggle mic
//   - 'cleanOutput'                   — note-on → toggle clean output
// Bindings store kind+channel+num so a re-bind works whether the user is
// using a CC knob or a pad. Defaults assume an Akai LPD8-style 8-pad
// controller on channel 0, easy to override via MIDI Learn.

export type MidiBindKind = 'cc' | 'note';
export interface MidiBinding {
  kind: MidiBindKind;
  channel: number;     // 0..15
  num: number;         // 0..127
}

export type MidiTarget =
  | 'crossfader'
  | `bank:${number}`
  | `clip:${number}`
  | 'micToggle'
  | 'cleanOutput'
  | 'autopilotToggle';

export type MidiMappings = Partial<Record<MidiTarget, MidiBinding>>;

/** Event the renderer-facing layer cares about. */
export interface MidiEvent {
  binding: MidiBinding;
  /** 0..1 — for CC, value/127; for note-on, velocity/127. */
  value: number;
  /** True for note-on with velocity > 0. False for CC and note-off. */
  isTrigger: boolean;
}

/** Public status for the settings UI. */
export type MidiStatus =
  | 'unavailable'      // Web MIDI not implemented in this engine
  | 'idle'             // not yet requested
  | 'requesting'       // awaiting permission
  | 'connected'        // listening
  | 'denied'           // user said no
  | 'error';

/** Sensible factory defaults — Akai LPD8 / generic 8-pad on channel 0.
 *  Crossfader → mod wheel (CC 1) so a touch surface or knob bank can
 *  drive it without any per-device config. */
export const DEFAULT_MIDI_MAPPINGS: MidiMappings = {
  crossfader:   { kind: 'cc',   channel: 0, num: 1 },
  'bank:0':     { kind: 'note', channel: 0, num: 48 },
  'bank:1':     { kind: 'note', channel: 0, num: 49 },
  'bank:2':     { kind: 'note', channel: 0, num: 50 },
  'bank:3':     { kind: 'note', channel: 0, num: 51 },
  'clip:0':     { kind: 'note', channel: 0, num: 52 },
  'clip:1':     { kind: 'note', channel: 0, num: 53 },
  'clip:2':     { kind: 'note', channel: 0, num: 54 },
  'clip:3':     { kind: 'note', channel: 0, num: 55 },
  'clip:4':     { kind: 'note', channel: 0, num: 56 },
  'clip:5':     { kind: 'note', channel: 0, num: 57 },
  'clip:6':     { kind: 'note', channel: 0, num: 58 },
  'clip:7':     { kind: 'note', channel: 0, num: 59 },
  'clip:8':     { kind: 'note', channel: 0, num: 60 },
  micToggle:        { kind: 'note', channel: 0, num: 64 },
  cleanOutput:      { kind: 'note', channel: 0, num: 65 },
  autopilotToggle:  { kind: 'note', channel: 0, num: 66 },
};

/** True if the runtime supports Web MIDI (desktop Chrome, Android Capacitor). */
export function isWebMidiAvailable(): boolean {
  return typeof navigator !== 'undefined' && typeof (navigator as any).requestMIDIAccess === 'function';
}

type RawMessage = { kind: MidiBindKind; channel: number; num: number; value: number };

/** Decode a 3-byte MIDI message into a typed event, or null if it's
 *  one we don't care about (clock, SysEx, aftertouch, etc.). */
function decode(data: Uint8Array): RawMessage | null {
  if (data.length < 2) return null;
  const status = data[0];
  const high = status & 0xf0;
  const channel = status & 0x0f;
  if (high === 0xb0) {
    // Control Change
    return { kind: 'cc', channel, num: data[1], value: data[2] ?? 0 };
  }
  if (high === 0x90) {
    // Note On (with velocity 0 = note off in MIDI 1)
    return { kind: 'note', channel, num: data[1], value: data[2] ?? 0 };
  }
  if (high === 0x80) {
    // Note Off
    return { kind: 'note', channel, num: data[1], value: 0 };
  }
  return null;
}

export interface StandaloneMidiOptions {
  /** Fired whenever a mapped control fires. The app routes this to the
   *  matching VJ action. */
  onEvent: (target: MidiTarget, ev: MidiEvent) => void;
  /** Fired on every decoded incoming message — used by MIDI Learn to
   *  capture the next control the user wiggles. */
  onRawMessage?: (msg: RawMessage) => void;
  /** Status changes — wire to UI to show "connected" / "denied" etc. */
  onStatusChange?: (status: MidiStatus, devices: string[]) => void;
  /** Initial mappings. */
  mappings: MidiMappings;
}

/** Web MIDI wrapper. Single instance; stop() releases all listeners. */
export class StandaloneMidi {
  private access: any = null;     // MIDIAccess
  private opts: StandaloneMidiOptions;
  public mappings: MidiMappings;
  public status: MidiStatus;
  public devices: string[] = [];

  constructor(opts: StandaloneMidiOptions) {
    this.opts = opts;
    this.mappings = { ...opts.mappings };
    this.status = isWebMidiAvailable() ? 'idle' : 'unavailable';
  }

  async start(): Promise<void> {
    if (!isWebMidiAvailable()) {
      this.setStatus('unavailable');
      return;
    }
    if (this.status === 'connected' || this.status === 'requesting') return;
    this.setStatus('requesting');
    try {
      this.access = await (navigator as any).requestMIDIAccess({ sysex: false });
      this.access.onstatechange = () => this.rebindInputs();
      this.rebindInputs();
      this.setStatus('connected');
    } catch (e: any) {
      const denied = /SecurityError|NotAllowedError|denied|permission/i.test(e?.name + ' ' + e?.message);
      this.setStatus(denied ? 'denied' : 'error');
    }
  }

  stop(): void {
    if (this.access) {
      try {
        for (const input of this.access.inputs.values()) input.onmidimessage = null;
        this.access.onstatechange = null;
      } catch { /* */ }
    }
    this.access = null;
    this.devices = [];
    this.setStatus('idle');
  }

  updateMappings(next: MidiMappings): void {
    this.mappings = { ...next };
  }

  /** Set or clear a single binding. Useful for the MIDI Learn flow. */
  setBinding(target: MidiTarget, binding: MidiBinding | null): void {
    if (binding) this.mappings = { ...this.mappings, [target]: binding };
    else {
      const next = { ...this.mappings };
      delete next[target];
      this.mappings = next;
    }
  }

  /** Find the target a binding points to (for displaying current
   *  bindings + detecting duplicates before assignment). */
  findTarget(binding: MidiBinding): MidiTarget | null {
    for (const t of Object.keys(this.mappings) as MidiTarget[]) {
      const b = this.mappings[t];
      if (b && b.kind === binding.kind && b.channel === binding.channel && b.num === binding.num) return t;
    }
    return null;
  }

  private setStatus(s: MidiStatus): void {
    this.status = s;
    this.opts.onStatusChange?.(s, this.devices.slice());
  }

  private rebindInputs(): void {
    if (!this.access) return;
    const names: string[] = [];
    for (const input of this.access.inputs.values()) {
      names.push(input.name ?? '(unnamed MIDI input)');
      input.onmidimessage = (msg: any) => this.handleMessage(msg.data);
    }
    this.devices = names;
    // Re-fire connected so the UI redraws the device list when a USB
    // controller is plugged in mid-session.
    if (this.status === 'connected') this.setStatus('connected');
  }

  private handleMessage(data: Uint8Array): void {
    const raw = decode(data);
    if (!raw) return;
    this.opts.onRawMessage?.(raw);
    // Find a binding that matches the incoming message.
    for (const t of Object.keys(this.mappings) as MidiTarget[]) {
      const b = this.mappings[t];
      if (!b) continue;
      if (b.kind !== raw.kind || b.channel !== raw.channel || b.num !== raw.num) continue;
      const value = raw.value / 127;
      const isTrigger = raw.kind === 'note' && raw.value > 0;
      this.opts.onEvent(t, { binding: b, value, isTrigger });
    }
  }
}
