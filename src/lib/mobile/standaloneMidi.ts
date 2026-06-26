// Mobile-standalone MIDI input via Web MIDI API.
//
// Works on Chrome-based Android WebViews (Capacitor) and desktop Chrome
// (for the dev server). iOS Safari/WebKit does not implement Web MIDI yet,
// so on iOS this module exits early in its `status` getter; an iOS native
// Capacitor MIDI bridge can land later behind the same interface.
//
// Mappings are stored as `MidiTarget → MidiBinding` pairs. Legacy targets
// (`clip:N`, `bank:N`, `crossfader`) are still accepted, but the real
// standalone app target model is path-like so MIDI and OSC can address
// layer opacity, mapping corners, edge fade, blend mode, and effect params.
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
  | `layer:${number}:opacity`
  | `layer:${number}:enabled`
  | `layer:${number}:mapped`
  | `layer:${number}:edge`
  | `layer:${number}:speed`
  | `layer:${number}:intensity`
  | `layer:${number}:blend`
  | `layer:${number}:corner:${number}:x`
  | `layer:${number}:corner:${number}:y`
  | `layer:${number}:effect:${string}:${string}`
  | `snapshot:${number}`
  | 'micToggle'
  | 'cleanOutput'
  | 'autopilotToggle';

export type MidiMappings = Partial<Record<MidiTarget, MidiBinding>>;

export interface ControllerTargetDef {
  target: MidiTarget;
  label: string;
  group: string;
  mode: 'continuous' | 'trigger';
}

const CONTROLLER_LAYER_COUNT = 4;
const CONTROLLER_SNAPSHOT_COUNT = 16;

function snapshotNoteMappings(notes: number[], channel = 0): MidiMappings {
  const mappings: MidiMappings = {};
  notes.forEach((num, i) => {
    mappings[`snapshot:${i}` as MidiTarget] = { kind: 'note', channel, num };
  });
  return mappings;
}

export const GLOBAL_CONTROLLER_TARGETS: ControllerTargetDef[] = [
  { target: 'micToggle', label: 'Toggle mic', group: 'Global', mode: 'trigger' },
  { target: 'cleanOutput', label: 'Clean output', group: 'Global', mode: 'trigger' },
  { target: 'autopilotToggle', label: 'Record', group: 'Global', mode: 'trigger' },
];

export function standaloneLayerControllerTargets(layerCount = CONTROLLER_LAYER_COUNT): ControllerTargetDef[] {
  const out: ControllerTargetDef[] = [];
  for (let i = 0; i < layerCount; i++) {
    const group = `Layer ${i + 1}`;
    out.push(
      { target: `layer:${i}:opacity`, label: `L${i + 1} opacity`, group, mode: 'continuous' },
      { target: `layer:${i}:enabled`, label: `L${i + 1} on/off`, group, mode: 'trigger' },
      { target: `layer:${i}:blend`, label: `L${i + 1} blend mode`, group, mode: 'trigger' },
      { target: `layer:${i}:mapped`, label: `L${i + 1} mapping on/off`, group, mode: 'trigger' },
      { target: `layer:${i}:edge`, label: `L${i + 1} edge fade`, group, mode: 'continuous' },
      { target: `layer:${i}:speed`, label: `L${i + 1} speed`, group, mode: 'continuous' },
      { target: `layer:${i}:intensity`, label: `L${i + 1} audio intensity`, group, mode: 'continuous' },
    );
    for (let corner = 0; corner < 4; corner++) {
      const name = ['TL', 'TR', 'BR', 'BL'][corner];
      out.push(
        { target: `layer:${i}:corner:${corner}:x`, label: `L${i + 1} ${name} X`, group: `${group} Mapping`, mode: 'continuous' },
        { target: `layer:${i}:corner:${corner}:y`, label: `L${i + 1} ${name} Y`, group: `${group} Mapping`, mode: 'continuous' },
      );
    }
  }
  return out;
}

export function defaultControllerTargets(layerCount = CONTROLLER_LAYER_COUNT): ControllerTargetDef[] {
  const snapshotTargets: ControllerTargetDef[] = Array.from({ length: CONTROLLER_SNAPSHOT_COUNT }, (_, i) => ({
    target: `snapshot:${i}` as MidiTarget,
    label: `Snapshot ${i + 1}`,
    group: 'Snapshots',
    mode: 'trigger',
  }));
  return [
    ...standaloneLayerControllerTargets(layerCount),
    ...snapshotTargets,
    ...GLOBAL_CONTROLLER_TARGETS,
  ];
}

export function isStandaloneControllerTarget(value: unknown): value is MidiTarget {
  if (value === 'crossfader' || value === 'micToggle' || value === 'cleanOutput' || value === 'autopilotToggle') return true;
  if (typeof value !== 'string') return false;
  return /^(bank|clip):\d+$/.test(value)
    || /^snapshot:\d+$/.test(value)
    || /^layer:\d+:(opacity|enabled|mapped|edge|speed|intensity|blend)$/.test(value)
    || /^layer:\d+:corner:[0-3]:(x|y)$/.test(value)
    || /^layer:\d+:effect:[A-Za-z0-9_-]+:[A-Za-z0-9_.-]+$/.test(value);
}

export interface MidiLayoutPreset {
  id: string;
  name: string;
  controller: string;
  description: string;
  mappings: MidiMappings;
}

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
  ...snapshotNoteMappings([36, 37, 38, 39, 40, 41, 42, 43]),
  'layer:0:opacity': { kind: 'cc', channel: 0, num: 20 },
  'layer:1:opacity': { kind: 'cc', channel: 0, num: 21 },
  'layer:2:opacity': { kind: 'cc', channel: 0, num: 22 },
  'layer:3:opacity': { kind: 'cc', channel: 0, num: 23 },
  'layer:0:speed': { kind: 'cc', channel: 0, num: 24 },
  'layer:1:speed': { kind: 'cc', channel: 0, num: 25 },
  'layer:2:speed': { kind: 'cc', channel: 0, num: 26 },
  'layer:3:speed': { kind: 'cc', channel: 0, num: 27 },
  'layer:0:intensity': { kind: 'cc', channel: 0, num: 28 },
  'layer:1:intensity': { kind: 'cc', channel: 0, num: 29 },
  'layer:2:intensity': { kind: 'cc', channel: 0, num: 30 },
  'layer:3:intensity': { kind: 'cc', channel: 0, num: 31 },
  'layer:0:enabled': { kind: 'note', channel: 0, num: 48 },
  'layer:1:enabled': { kind: 'note', channel: 0, num: 49 },
  'layer:2:enabled': { kind: 'note', channel: 0, num: 50 },
  'layer:3:enabled': { kind: 'note', channel: 0, num: 51 },
  micToggle:        { kind: 'note', channel: 0, num: 64 },
  cleanOutput:      { kind: 'note', channel: 0, num: 65 },
  autopilotToggle:  { kind: 'note', channel: 0, num: 66 },
};

export const DEFAULT_MIDI_PRESET_ID = 'generic-lpd8';

export const MIDI_LAYOUT_PRESETS: MidiLayoutPreset[] = [
  {
    id: DEFAULT_MIDI_PRESET_ID,
    name: 'Generic 8-pad',
    controller: 'Akai LPD8-style',
    description: 'Small pad/knob starter map: pads recall snapshots, knobs drive layer opacity, and extra pads handle transport actions.',
    mappings: DEFAULT_MIDI_MAPPINGS,
  },
  {
    id: 'akai-apc-mini',
    name: 'APC Mini',
    controller: 'Akai APC Mini / APC Mini Mk2-style',
    description: 'Grid/fader workflow: first 16 pads recall snapshots, faders drive layer opacity, and scene buttons handle performance actions.',
    mappings: {
      crossfader:       { kind: 'cc', channel: 0, num: 56 },
      ...snapshotNoteMappings([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]),
      'layer:0:opacity': { kind: 'cc', channel: 0, num: 48 },
      'layer:1:opacity': { kind: 'cc', channel: 0, num: 49 },
      'layer:2:opacity': { kind: 'cc', channel: 0, num: 50 },
      'layer:3:opacity': { kind: 'cc', channel: 0, num: 51 },
      'layer:0:speed': { kind: 'cc', channel: 0, num: 52 },
      'layer:1:speed': { kind: 'cc', channel: 0, num: 53 },
      'layer:2:speed': { kind: 'cc', channel: 0, num: 54 },
      'layer:3:speed': { kind: 'cc', channel: 0, num: 55 },
      'layer:0:intensity': { kind: 'cc', channel: 0, num: 57 },
      'layer:1:intensity': { kind: 'cc', channel: 0, num: 58 },
      'layer:2:intensity': { kind: 'cc', channel: 0, num: 59 },
      'layer:3:intensity': { kind: 'cc', channel: 0, num: 60 },
      'layer:0:enabled': { kind: 'note', channel: 0, num: 64 },
      'layer:1:enabled': { kind: 'note', channel: 0, num: 65 },
      'layer:2:enabled': { kind: 'note', channel: 0, num: 66 },
      'layer:3:enabled': { kind: 'note', channel: 0, num: 67 },
      micToggle:        { kind: 'note', channel: 0, num: 82 },
      cleanOutput:      { kind: 'note', channel: 0, num: 83 },
      autopilotToggle:  { kind: 'note', channel: 0, num: 84 },
    },
  },
  {
    id: 'novation-launchpad',
    name: 'Launchpad',
    controller: 'Novation Launchpad-style',
    description: 'Pad-first map for tablet VJ mode: first two rows recall snapshots, the next row toggles layers, and side controls handle output.',
    mappings: {
      ...snapshotNoteMappings([11, 12, 13, 14, 15, 16, 17, 18, 21, 22, 23, 24, 25, 26, 27, 28]),
      'layer:0:enabled': { kind: 'note', channel: 0, num: 31 },
      'layer:1:enabled': { kind: 'note', channel: 0, num: 32 },
      'layer:2:enabled': { kind: 'note', channel: 0, num: 33 },
      'layer:3:enabled': { kind: 'note', channel: 0, num: 34 },
      micToggle:        { kind: 'note', channel: 0, num: 89 },
      cleanOutput:      { kind: 'note', channel: 0, num: 79 },
      autopilotToggle:  { kind: 'note', channel: 0, num: 69 },
    },
  },
  {
    id: 'korg-nanokontrol',
    name: 'nanoKONTROL',
    controller: 'Korg nanoKONTROL2-style',
    description: 'Fader-heavy mix map: first four sliders drive layer opacity, upper button banks recall snapshots, transport handles record and output.',
    mappings: {
      crossfader:       { kind: 'cc', channel: 0, num: 7 },
      ...snapshotNoteMappings([48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63]),
      'layer:0:opacity': { kind: 'cc', channel: 0, num: 0 },
      'layer:1:opacity': { kind: 'cc', channel: 0, num: 1 },
      'layer:2:opacity': { kind: 'cc', channel: 0, num: 2 },
      'layer:3:opacity': { kind: 'cc', channel: 0, num: 3 },
      'layer:0:edge': { kind: 'cc', channel: 0, num: 16 },
      'layer:1:edge': { kind: 'cc', channel: 0, num: 17 },
      'layer:2:edge': { kind: 'cc', channel: 0, num: 18 },
      'layer:3:edge': { kind: 'cc', channel: 0, num: 19 },
      'layer:0:speed': { kind: 'cc', channel: 0, num: 20 },
      'layer:1:speed': { kind: 'cc', channel: 0, num: 21 },
      'layer:2:speed': { kind: 'cc', channel: 0, num: 22 },
      'layer:3:speed': { kind: 'cc', channel: 0, num: 23 },
      'layer:0:intensity': { kind: 'cc', channel: 0, num: 24 },
      'layer:1:intensity': { kind: 'cc', channel: 0, num: 25 },
      'layer:2:intensity': { kind: 'cc', channel: 0, num: 26 },
      'layer:3:intensity': { kind: 'cc', channel: 0, num: 27 },
      'layer:0:enabled': { kind: 'note', channel: 0, num: 32 },
      'layer:1:enabled': { kind: 'note', channel: 0, num: 33 },
      'layer:2:enabled': { kind: 'note', channel: 0, num: 34 },
      'layer:3:enabled': { kind: 'note', channel: 0, num: 35 },
      micToggle:        { kind: 'note', channel: 0, num: 41 },
      cleanOutput:      { kind: 'note', channel: 0, num: 42 },
      autopilotToggle:  { kind: 'note', channel: 0, num: 45 },
    },
  },
];

export function findMidiLayoutPreset(id: string | null | undefined): MidiLayoutPreset {
  return MIDI_LAYOUT_PRESETS.find(p => p.id === id) ?? MIDI_LAYOUT_PRESETS[0];
}

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
