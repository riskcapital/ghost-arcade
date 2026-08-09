// MIDI Store - Svelte writable store with localStorage persistence
import { writable, get } from 'svelte/store';
import type { MidiStoreState, MidiMapping, MidiDevice, MidiMappingMode, MidiMessageType } from './midiTypes';

const STORAGE_KEY = 'ghost-arcade_midi_mappings';
const DEVICE_KEY = 'ghost-arcade_midi_device';
const CLOCK_DEVICE_KEY = 'ghost-arcade_midi_clock_device';
const OUTPUT_KEY = 'ghost-arcade_midi_output';
const CLOCK_IN_KEY = 'ghost-arcade_midi_clock_in';
const CLOCK_OUT_KEY = 'ghost-arcade_midi_clock_out';

function loadMappings(): MidiMapping[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return [];
}

function saveMappings(mappings: MidiMapping[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(mappings));
  } catch { /* ignore */ }
}

function loadSelectedDevice(): string | null {
  try {
    return localStorage.getItem(DEVICE_KEY);
  } catch { return null; }
}

function saveSelectedDevice(id: string | null) {
  try {
    if (id) localStorage.setItem(DEVICE_KEY, id);
    else localStorage.removeItem(DEVICE_KEY);
  } catch { /* ignore */ }
}

function loadSelectedClockDevice(): string | null {
  try {
    return localStorage.getItem(CLOCK_DEVICE_KEY);
  } catch { return null; }
}

function saveSelectedClockDevice(id: string | null) {
  try {
    if (id) localStorage.setItem(CLOCK_DEVICE_KEY, id);
    else localStorage.removeItem(CLOCK_DEVICE_KEY);
  } catch { /* ignore */ }
}

function loadSelectedOutput(): string | null {
  try { return localStorage.getItem(OUTPUT_KEY); } catch { return null; }
}
function saveSelectedOutput(id: string | null) {
  try {
    if (id) localStorage.setItem(OUTPUT_KEY, id);
    else localStorage.removeItem(OUTPUT_KEY);
  } catch { /* ignore */ }
}
function loadClockInEnabled(): boolean {
  try { return localStorage.getItem(CLOCK_IN_KEY) === '1'; } catch { return false; }
}
function saveClockInEnabled(v: boolean) {
  try { localStorage.setItem(CLOCK_IN_KEY, v ? '1' : '0'); } catch { /* ignore */ }
}
function loadClockOutEnabled(): boolean {
  try { return localStorage.getItem(CLOCK_OUT_KEY) === '1'; } catch { return false; }
}
function saveClockOutEnabled(v: boolean) {
  try { localStorage.setItem(CLOCK_OUT_KEY, v ? '1' : '0'); } catch { /* ignore */ }
}

// UUID generator with fallback
function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function createDefaultLearn(): MidiStoreState['learn'] {
  return {
    active: false,
    targetPath: null,
    targetLabel: null,
    targetMin: 0,
    targetMax: 1,
    targetStep: 0,
    targetMode: 'absolute',
  };
}

function createDefaultState(): MidiStoreState {
  return {
    available: false,
    devices: [],
    outputDevices: [],
    selectedDeviceId: loadSelectedDevice(),
    selectedClockInputId: loadSelectedClockDevice(),
    selectedOutputId: loadSelectedOutput(),
    mappings: loadMappings(),
    editMode: false,
    learn: createDefaultLearn(),
    lastMessage: null,
    clockInEnabled: loadClockInEnabled(),
    clockInRunning: false,
    clockInBPM: null,
    clockOutEnabled: loadClockOutEnabled(),
  };
}

function createMidiStore() {
  const { subscribe, update } = writable<MidiStoreState>(createDefaultState());

  return {
    subscribe,

    setAvailable: (available: boolean) => update(s => ({ ...s, available })),

    setDevices: (devices: MidiDevice[]) => update(s => ({ ...s, devices })),

    setOutputDevices: (devices: MidiDevice[]) => update(s => ({ ...s, outputDevices: devices })),

    selectDevice: (deviceId: string | null) => {
      saveSelectedDevice(deviceId);
      update(s => ({ ...s, selectedDeviceId: deviceId }));
    },

    selectClockInput: (deviceId: string | null) => {
      saveSelectedClockDevice(deviceId);
      update(s => ({ ...s, selectedClockInputId: deviceId }));
    },

    selectOutput: (deviceId: string | null) => {
      saveSelectedOutput(deviceId);
      update(s => ({ ...s, selectedOutputId: deviceId }));
    },

    setClockInEnabled: (enabled: boolean) => {
      saveClockInEnabled(enabled);
      update(s => ({ ...s, clockInEnabled: enabled }));
    },

    setClockInRunning: (running: boolean) =>
      update(s => ({ ...s, clockInRunning: running })),

    setClockInBPM: (bpm: number | null) =>
      update(s => ({ ...s, clockInBPM: bpm })),

    setClockOutEnabled: (enabled: boolean) => {
      saveClockOutEnabled(enabled);
      update(s => ({ ...s, clockOutEnabled: enabled }));
    },

    toggleEditMode: () => update(s => {
      const newEdit = !s.editMode;
      return {
        ...s,
        editMode: newEdit,
        learn: newEdit ? s.learn : createDefaultLearn(),
      };
    }),

    setEditMode: (on: boolean) => update(s => ({
      ...s,
      editMode: on,
      learn: on ? s.learn : createDefaultLearn(),
    })),

    // Start learning for a specific control
    startLearn: (path: string, label: string, min: number, max: number, step: number, mode: MidiMappingMode, discreteValues?: string[]) =>
      update(s => ({
        ...s,
        learn: {
          active: true,
          targetPath: path,
          targetLabel: label,
          targetMin: min,
          targetMax: max,
          targetStep: step,
          targetMode: mode,
          targetDiscreteValues: discreteValues,
        },
      })),

    cancelLearn: () => update(s => ({
      ...s,
      learn: createDefaultLearn(),
    })),

    // Complete learn: create mapping from received MIDI message
    completeLearn: (channel: number, type: MidiMessageType, number: number) => update(s => {
      if (!s.learn.active || !s.learn.targetPath) return s;

      const mapping: MidiMapping = {
        id: generateId(),
        channel,
        type,
        number,
        path: s.learn.targetPath,
        min: s.learn.targetMin,
        max: s.learn.targetMax,
        step: s.learn.targetStep,
        mode: s.learn.targetMode,
        label: s.learn.targetLabel || s.learn.targetPath,
        discreteValues: s.learn.targetDiscreteValues,
      };

      // Remove any existing mapping for same path (one CC per control)
      const filtered = s.mappings.filter(m => m.path !== mapping.path);
      const newMappings = [...filtered, mapping];
      saveMappings(newMappings);

      return {
        ...s,
        mappings: newMappings,
        learn: createDefaultLearn(),
      };
    }),

    removeMapping: (path: string) => update(s => {
      const newMappings = s.mappings.filter(m => m.path !== path);
      saveMappings(newMappings);
      return { ...s, mappings: newMappings };
    }),

    removeMappingById: (id: string) => update(s => {
      const newMappings = s.mappings.filter(m => m.id !== id);
      saveMappings(newMappings);
      return { ...s, mappings: newMappings };
    }),

    clearAllMappings: () => update(s => {
      saveMappings([]);
      return { ...s, mappings: [] };
    }),

    setLastMessage: (msg: MidiStoreState['lastMessage']) => update(s => ({ ...s, lastMessage: msg })),

    getMappingForPath: (path: string): MidiMapping | undefined => {
      return get({ subscribe }).mappings.find(m => m.path === path);
    },

    getMappingsForMessage: (channel: number, type: MidiMessageType, number: number): MidiMapping[] => {
      return get({ subscribe }).mappings.filter(m =>
        m.type === type &&
        m.number === number &&
        (m.channel === -1 || m.channel === channel)
      );
    },
  };
}

export const midiStore = createMidiStore();
