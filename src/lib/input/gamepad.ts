// Gamepad input layer — Web Gamepad API, no native code, works in
// Electron + browser with any Bluetooth/USB controller (Xbox, DualShock,
// 8BitDo, ...) under the W3C "standard" mapping.
//
// Two consumers, two access patterns:
//   • getGamepadState()  — synchronous snapshot read by the render loop
//                          every frame (no store overhead, no GC).
//   • gamepadStore       — Svelte store for UI (connected badge, live
//                          input readout). Updated at a throttled rate.
//
// Rising-edge detection uses PER-BUTTON PRESS COUNTERS rather than a
// "justPressed" boolean: the poll loop and a consumer's render loop are
// both rAF-driven but not guaranteed aligned, so a boolean could be
// missed or double-read. A consumer remembers the last counter it saw
// and fires once per increment — race-free regardless of timing.

import { writable } from 'svelte/store';

/** W3C standard-mapping button indices. */
export const BTN = {
  A: 0, B: 1, X: 2, Y: 3,
  LB: 4, RB: 5, LT: 6, RT: 7,
  BACK: 8, START: 9, LSTICK: 10, RSTICK: 11,
  DUP: 12, DDOWN: 13, DLEFT: 14, DRIGHT: 15,
  HOME: 16,
} as const;

export interface GamepadState {
  connected: boolean;
  /** Deadzoned analog sticks, -1..1 (y up-positive, inverted from the raw
   *  axis so pushing up reads positive). */
  lx: number; ly: number;
  rx: number; ry: number;
  /** Triggers 0..1. */
  lt: number; rt: number;
  /** Current analog value per button index (0..1). */
  buttons: number[];
  /** Monotonic press counter per button — increments on each rising edge. */
  pressCounts: number[];
  /** id string of the active pad (for the UI). */
  id: string;
}

const NUM_BUTTONS = 17;

function emptyState(): GamepadState {
  return {
    connected: false,
    lx: 0, ly: 0, rx: 0, ry: 0,
    lt: 0, rt: 0,
    buttons: new Array(NUM_BUTTONS).fill(0),
    pressCounts: new Array(NUM_BUTTONS).fill(0),
    id: '',
  };
}

const STICK_DEADZONE = 0.12;
const TRIGGER_DEADZONE = 0.04;
const PRESS_THRESHOLD = 0.5;

/** Radial deadzone + rescale so the live range starts at the deadzone
 *  edge (no jump from 0 to deadzone). */
function applyDeadzone(v: number, dz: number): number {
  const a = Math.abs(v);
  if (a < dz) return 0;
  const scaled = (a - dz) / (1 - dz);
  return Math.sign(v) * Math.min(1, scaled);
}

// Live snapshot — the render loop reads this directly.
const state = emptyState();
// Previous "is pressed" per button, for edge detection.
const wasPressed = new Array(NUM_BUTTONS).fill(false);

// Synthetic override (CDP tests + the no-hardware preview). When set,
// real hardware is ignored so tests are deterministic.
let synthetic: Partial<GamepadState> | null = null;

let pollHandle = 0;
let running = false;
let storeThrottle = 0;

export const gamepadStore = writable<GamepadState>(emptyState());

function readHardware(): Gamepad | null {
  if (typeof navigator === 'undefined' || !navigator.getGamepads) return null;
  const pads = navigator.getGamepads();
  if (!pads) return null;
  // First connected pad with the standard mapping wins; fall back to any
  // connected pad (some pads report mapping="" but still use std order).
  let fallback: Gamepad | null = null;
  for (const p of pads) {
    if (!p) continue;
    if (p.mapping === 'standard') return p;
    if (!fallback) fallback = p;
  }
  return fallback;
}

function poll() {
  if (synthetic) {
    applySnapshot({ ...emptyState(), connected: true, id: 'synthetic', ...synthetic });
  } else {
    const pad = readHardware();
    if (!pad) {
      if (state.connected) { Object.assign(state, emptyState()); pushStore(); }
    } else {
      const ax = pad.axes;
      const snap = emptyState();
      snap.connected = true;
      snap.id = pad.id;
      snap.lx = applyDeadzone(ax[0] ?? 0, STICK_DEADZONE);
      snap.ly = applyDeadzone(-(ax[1] ?? 0), STICK_DEADZONE);   // up = +
      snap.rx = applyDeadzone(ax[2] ?? 0, STICK_DEADZONE);
      snap.ry = applyDeadzone(-(ax[3] ?? 0), STICK_DEADZONE);
      for (let i = 0; i < NUM_BUTTONS; i++) {
        snap.buttons[i] = pad.buttons[i]?.value ?? 0;
      }
      snap.lt = applyDeadzone(snap.buttons[BTN.LT], TRIGGER_DEADZONE);
      snap.rt = applyDeadzone(snap.buttons[BTN.RT], TRIGGER_DEADZONE);
      applySnapshot(snap);
    }
  }

  // Throttle the Svelte store to ~20Hz — UI doesn't need 60Hz, and the
  // render loop reads getGamepadState() directly anyway.
  storeThrottle++;
  if (storeThrottle >= 3) { storeThrottle = 0; pushStore(); }

  if (running) pollHandle = requestAnimationFrame(poll);
}

/** Merge a freshly-read snapshot into the live state, advancing press
 *  counters on rising edges. pressCounts persist across snapshots. */
function applySnapshot(snap: GamepadState) {
  state.connected = snap.connected;
  state.id = snap.id;
  state.lx = snap.lx; state.ly = snap.ly;
  state.rx = snap.rx; state.ry = snap.ry;
  state.lt = snap.lt; state.rt = snap.rt;
  for (let i = 0; i < NUM_BUTTONS; i++) {
    state.buttons[i] = snap.buttons[i] ?? 0;
    const pressed = state.buttons[i] >= PRESS_THRESHOLD;
    if (pressed && !wasPressed[i]) state.pressCounts[i]++;
    wasPressed[i] = pressed;
  }
}

function pushStore() {
  gamepadStore.set({
    ...state,
    buttons: [...state.buttons],
    pressCounts: [...state.pressCounts],
  });
}

/** Synchronous live snapshot for the render loop. Returns the shared
 *  object — do NOT mutate it; copy fields you need. */
export function getGamepadState(): GamepadState {
  return state;
}

export function startGamepadPolling(): void {
  if (running) return;
  running = true;
  // Debug/automation hook on the SAME module instance the consumers use
  // (CDP tests + the no-hardware preview drive input through here).
  try {
    (window as any).__ghostGamepad = { setSyntheticGamepad, getGamepadState, BTN };
  } catch { /* sealed */ }
  if (typeof window !== 'undefined') {
    window.addEventListener('gamepadconnected', onConnect);
    window.addEventListener('gamepaddisconnected', onConnect);
  }
  pollHandle = requestAnimationFrame(poll);
}

export function stopGamepadPolling(): void {
  running = false;
  if (pollHandle) cancelAnimationFrame(pollHandle);
  pollHandle = 0;
  if (typeof window !== 'undefined') {
    window.removeEventListener('gamepadconnected', onConnect);
    window.removeEventListener('gamepaddisconnected', onConnect);
  }
}

function onConnect() { /* presence reflected on next poll */ }

/** Test / no-hardware-preview hook. Pass a partial state to drive the
 *  pilot without a physical controller; pass null to release. Buttons:
 *  set buttons[i] >= 0.5 to register a press (counter advances on the
 *  rising edge, same as hardware). */
export function setSyntheticGamepad(s: Partial<GamepadState> | null): void {
  synthetic = s;
  if (s && !running) startGamepadPolling();
}

/** True when a real or synthetic pad is present. */
export function isGamepadConnected(): boolean {
  return state.connected;
}
