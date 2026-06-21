// MIDI Mapping System - Type Definitions

// --- Parameter path conventions ---
// Mapping mode:  "map:splat:<property>"          e.g. "map:splat:pointSize"
// Mapping mode:  "map:model3d:<property>"        e.g. "map:model3d:materialOpacity"
// Mapping mode:  "map:model3d:echo.<property>"   e.g. "map:model3d:echo.count"
// Mapping mode:  "map:layer:<property>"          e.g. "map:layer:opacity"
// Mapping mode:  "map:stage-effect:<id>:hold"    (Momentary trigger)
// VJ mode:       "vj:<layerIndex>:opacity"       e.g. "vj:0:opacity"
// VJ mode:       "vj:<layerIndex>:shader:<name>" e.g. "vj:2:shader:speed"
// VJ mode:       "vj:master:opacity"
// Performer:     "sv:xfade"
// Performer:     "sv:param:<key>"                e.g. "sv:param:chaos"
// Performer:     "sv:shader:<idx>:<key>"         e.g. "sv:shader:0:tunnelR"
// Performer:     "sv:world:<idx>:<key>"          e.g. "sv:world:3:height"
// Performer:     "sv:clip:<index>"               e.g. "sv:clip:5" (Note trigger)
// Performer:     "sv:bpm"
// Performer:     "sv:camOpacity"
// Performer:     "sv:spaceFx"                    (Note trigger)
// VJ mode:       "vj:block:<index>"              (Note trigger — switch block)
// VJ mode:       "vj:column:<index>"             (Note trigger — trigger entire column)
// VJ mode:       "vj:stage:<index>"              (Note trigger — load stage preset)
// VJ mode:       "vj:stopall"                    (Note trigger — stop all clips)
// Mapping:       "map:preset:<index>"            (Note trigger — load mapping preset)

export type MidiMessageType = 'cc' | 'note' | 'pitchbend';

export type MidiMappingMode = 'absolute' | 'toggle' | 'relative';
// absolute: CC 0-127 maps linearly to min-max
// toggle: Note On/Off or CC > 64 toggles boolean
// relative: CC increment/decrement (for encoders, value 65+ = up, 63- = down)

export interface MidiMapping {
  id: string;                  // UUID
  channel: number;             // 0-15 MIDI channel, or -1 for "any channel"
  type: MidiMessageType;
  number: number;              // CC number (0-127), Note number, or 0 for pitchbend
  path: string;                // Parameter path (see conventions above)
  min: number;                 // Target range min (e.g. 0.01 for pointDensity)
  max: number;                 // Target range max (e.g. 1 for pointDensity)
  step: number;                // Quantization step (e.g. 0.01) -- 0 for continuous
  mode: MidiMappingMode;
  label: string;               // Human-readable: "Point Size", "Layer 1 Opacity"
  discreteValues?: string[];   // For dropdowns: ordered list of option values
}

export interface MidiDevice {
  id: string;                  // WebMIDI device id
  name: string;                // Device name
  manufacturer: string;        // Manufacturer
  state: 'connected' | 'disconnected';
}

export interface MidiLearnState {
  active: boolean;             // Is learning mode active
  targetPath: string | null;   // Which parameter path we're learning for
  targetLabel: string | null;  // Human-readable label of the target
  targetMin: number;           // The target's min value
  targetMax: number;           // The target's max value
  targetStep: number;          // The target's step
  targetMode: MidiMappingMode; // Suggested mode (absolute/toggle)
  targetDiscreteValues?: string[]; // If it's a dropdown
}

export interface MidiStoreState {
  available: boolean;          // Web MIDI API supported
  devices: MidiDevice[];       // All detected MIDI input devices
  outputDevices: MidiDevice[]; // All detected MIDI output devices (for clock send)
  selectedDeviceId: string | null;  // Currently selected input device
  selectedOutputId: string | null;  // Currently selected output device for clock send
  mappings: MidiMapping[];     // All current mappings
  editMode: boolean;           // Is MIDI edit/overlay mode active
  learn: MidiLearnState;       // Current learn state
  lastMessage: {               // Last received MIDI message (for display)
    channel: number;
    type: MidiMessageType;
    number: number;
    value: number;
  } | null;

  // ===== MIDI Clock state =====
  // Clock IN: when the selected input device sends MIDI Clock (0xF8 ticks
  // at 24 PPQN), we infer BPM from the average tick interval and feed it
  // to audioStore as a high-priority BPM source. Lets users sync visuals
  // to a drum machine, Ableton, or any DAW with no extra hardware.
  clockInEnabled: boolean;
  clockInRunning: boolean;     // True when last 0xFA Start has not been balanced by 0xFC Stop
  clockInBPM: number | null;   // Latest computed BPM from incoming clock; null if no recent ticks
  // Clock OUT: emit 24 PPQN ticks to selectedOutputId at the current
  // master BPM. Lets Ghost Arcade act as the master clock for slaved gear.
  clockOutEnabled: boolean;
}
