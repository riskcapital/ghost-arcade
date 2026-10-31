// MIDI Manager - Web MIDI API wrapper with device detection and hot-plug
import { midiStore } from './midiStore';
import { midiRouter } from './midiRouter';
import { audioStore } from '../stores/audio';
import type { MidiDevice, MidiInputSetup, MidiMessageType } from './midiTypes';
import {
  emitBandKeys,
  mappingHearsDevice,
  midiInputSetups,
  midiInputsInUse,
  releaseBandKeys,
  resolveMidiInputs,
  sameInputsInUse,
  setMidiInputSetup,
  setupFor,
  type MidiInputsInUse,
} from './midiInputs';
import { get } from 'svelte/store';
import { vjClipLauncher } from '../stores/vjClipLauncher';
import { ControllerLights, pairedOutput } from './controllerLights';
import { controllerLightsStore } from './controllerLightsStore';
import { controllerProfiles, controllerCell, detectControllerProfile } from './controllerProfiles';

const CLOCK_PPQN = 24;
const CLOCK_BPM_MIN = 30;
const CLOCK_BPM_MAX = 300;

/**
 * Steady tempo from MIDI clock ticks (24 per quarter note).
 *
 * Fits a line through the last 48 tick times, so one late tick barely moves
 * it. A new tempo is reported when it moves 0.3 BPM or more (at most four
 * times a second), or 0.1 BPM in the same direction for a whole second.
 * Tick-to-tick jitter therefore never reaches the tempo (or Link peers).
 */
export class ClockTempoTracker {
  static readonly WINDOW = 48;
  static readonly MIN_TICKS = 24;
  static readonly STEP_BPM = 0.3;
  static readonly MIN_INTERVAL_MS = 250;
  static readonly DRIFT_HOLD_MS = 1000;
  /** A gap longer than this is a stopped clock, not a slow tick. */
  static readonly GAP_MS = 500;

  private ticks: number[] = [];
  private published: number | null = null;
  private publishedAt = -Infinity;
  private driftSince: number | null = null;
  private driftSign = 0;

  /** Drop tick history (transport Start). The last tempo is kept. */
  restart(): void {
    this.ticks = [];
    this.driftSince = null;
  }

  /** Forget everything (clock in turned off). */
  reset(): void {
    this.restart();
    this.published = null;
    this.publishedAt = -Infinity;
  }

  /** Add a tick at `timeMs`. Returns the tempo to publish, or null for no change. */
  tick(timeMs: number): number | null {
    const ticks = this.ticks;
    const last = ticks[ticks.length - 1];
    if (last !== undefined && (timeMs < last || timeMs - last > ClockTempoTracker.GAP_MS)) this.restart();
    ticks.push(timeMs);
    if (ticks.length > ClockTempoTracker.WINDOW) ticks.shift();
    if (ticks.length < ClockTempoTracker.MIN_TICKS) return null;

    // Least-squares slope of tick time against tick number: ms per tick.
    const n = ticks.length;
    const meanIndex = (n - 1) / 2;
    let meanTime = 0;
    for (let i = 0; i < n; i++) meanTime += ticks[i];
    meanTime /= n;
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      const di = i - meanIndex;
      num += di * (ticks[i] - meanTime);
      den += di * di;
    }
    const tickMs = num / den;
    if (!(tickMs > 0)) return null;
    const bpm = 60000 / (CLOCK_PPQN * tickMs);
    if (bpm < CLOCK_BPM_MIN || bpm > CLOCK_BPM_MAX) return null;
    const rounded = Math.round(bpm * 10) / 10;

    if (this.published === null) return this.publish(rounded, timeMs);
    const delta = rounded - this.published;
    const size = Math.abs(delta);
    if (size >= ClockTempoTracker.STEP_BPM - 1e-6) {
      return timeMs - this.publishedAt >= ClockTempoTracker.MIN_INTERVAL_MS ? this.publish(rounded, timeMs) : null;
    }
    if (size >= 0.1 - 1e-6) {
      const sign = Math.sign(delta);
      if (this.driftSince === null || sign !== this.driftSign) {
        this.driftSince = timeMs;
        this.driftSign = sign;
      } else if (timeMs - this.driftSince >= ClockTempoTracker.DRIFT_HOLD_MS) {
        return this.publish(rounded, timeMs);
      }
      return null;
    }
    this.driftSince = null;
    return null;
  }

  private publish(bpm: number, timeMs: number): number {
    this.published = bpm;
    this.publishedAt = timeMs;
    this.driftSince = null;
    return bpm;
  }
}

type InputRole = 'control' | 'keys';

export class MidiManager {
  private access: MIDIAccess | null = null;
  /** Inputs listened to now, and what for: controllers and the band's keys. */
  private inputs = new Map<string, { port: MIDIInput; role: InputRole; name: string }>();
  private activeClockInput: MIDIInput | null = null;
  private setups: MidiInputSetup[] = get(midiInputSetups);
  private setupsSubscription?: () => void;
  private refreshing = false;
  private inUse: MidiInputsInUse = { control: [], keys: [], standIn: null, controlNames: [] };
  private activeOutput: MIDIOutput | null = null;
  private lights = new ControllerLights(message => controllerLightsStore.status(message));
  private lightsFrame: number | null = null;
  private lightsSubscriptions: (() => void)[] = [];
  private gridHolds = new Map<string, string>();
  /** The input whose pads hold those clips (null: not known). */
  private gridHoldsFrom: string | null = null;
  private lightsRequest = 0;
  private clockSubscription?: () => void;
  private onWindowClose = () => this.destroy();
  private quitSubscription?: () => void;
  private boundMessageHandler = this.handleMessage.bind(this);

  // MIDI CC sweeps / aftertouch / pitch-bend can emit 500+ msg/sec. The
  // `lastMessage` field is purely cosmetic (shown in the MIDI Learn overlay),
  // but every call to `setLastMessage` fires full Svelte reactivity on every
  // `$midiStore` subscriber. Throttle to ~30 Hz so mod-wheel sweeps stop
  // re-rendering the panel on every data point. Learn-mode itself is already
  // driven by `completeLearn`, not `lastMessage`, so there's no learn regression.
  private _lastMsgTs = 0;
  private static _LAST_MSG_MIN_INTERVAL_MS = 33;

  // ===== MIDI Clock (receive) state =====
  // 24 PPQN means 24 ticks per quarter note. Tick times come from each
  // MIDI event's own timestamp; ClockTempoTracker turns them into a steady
  // tempo. Tick history resets on 0xFA Start so the first beat after Start is clean.
  private _clockTempo = new ClockTempoTracker();
  private static _CLOCK_PPQN = CLOCK_PPQN;
  // Stale-detection: if no tick arrives for >500ms we mark clock-in as
  // stopped so the BPM readout doesn't keep reporting the last known value.
  private _clockStaleTimer: ReturnType<typeof setTimeout> | null = null;
  private _clockStalePeriodMs = 500;

  // The input the user picked. While it is unplugged another input stands
  // in (not saved); when it comes back it takes over again. Undefined until
  // read from the saved selection on the first device scan.
  private chosenInputId: string | null | undefined = undefined;

  // Last clock-in BPM bridged into audioStore — used by the subscriber
  // installed in init() to dedupe writes. Reset to null on disable so a
  // re-enable at the same tempo doesn't get stale-skipped.
  private _clockInBpmCache: number | null = null;

  // ===== MIDI Clock (send) state =====
  // We schedule ticks ahead of time using the renderer's high-res timer
  // (performance.now() on the main thread, no clock drift from rAF). Each
  // call to _scheduleNextTick computes the next tick's wall time and posts
  // a setTimeout. WebMIDI doesn't support scheduled-send timestamps in
  // Electron 33's Chromium build (output.send accepts a timestamp arg but
  // Chromium ignores it in practice), so we drive ticks from JS.
  private _clockOutTimer: number | null = null;
  private _clockOutLastSendMs = 0;

  async init(): Promise<boolean> {
    if (!navigator.requestMIDIAccess) {
      console.warn('[MIDI] Web MIDI API not available');
      midiStore.setAvailable(false);
      return false;
    }
    try {
      // Workaround for an Electron 33.x bug on macOS: the FIRST renderer call to
      // requestMIDIAccess() in a packaged build hangs forever — the main-process
      // permission handler grants the request via callback(true), but Chromium
      // never observes the grant and the returned Promise never settles. A
      // subsequent call resolves immediately because the permission is then
      // cached. So we issue the first call, and if it doesn't resolve in 1.5s,
      // fire a second call and await whichever wins. The first hung promise
      // becomes a harmless dangling reference.
      this.access = await this.requestMIDIAccessWithRetry();
      midiStore.setAvailable(true);
      this.refreshDevices();
      this.access.onstatechange = () => this.refreshDevices();
      // A use changed in Settings takes effect at once.
      this.setupsSubscription?.();
      this.setupsSubscription = midiInputSetups.subscribe((list) => {
        this.setups = list;
        if (!this.refreshing) this.refreshDevices();
      });

      // Bridge clock-IN → audio store master BPM. When the user has clock-in
      // enabled and a transport is running, the latest computed BPM flows
      // into audioStore.manualBPM so every consumer (audio engine, VJ
      // quantization, modulation engine, header readout) sees the same
      // tempo. We subscribe AFTER access is granted so the listener is
      // ready before any downstream subscribers can race the bootstrap.
      //
      // The `_clockInBpmCache` field (on the manager class) is the
      // last-bridged value, used to dedupe subscriber notifications.
      // setClockInEnabled(false) resets it so a re-enable at the same
      // tempo doesn't get stale-skipped.
      this.clockSubscription?.();
      this.clockSubscription = midiStore.subscribe(s => {
        if (!s.clockInEnabled) return;
        if (s.clockInRunning && s.clockInBPM != null && s.clockInBPM !== this._clockInBpmCache) {
          this._clockInBpmCache = s.clockInBPM;
          audioStore.setManualBPM(s.clockInBPM);
        }
      });

      this.startControllerLights();
      console.log('[MIDI] Initialized successfully');
      return true;
    } catch (err) {
      console.error('[MIDI] Failed to get MIDI access:', err);
      midiStore.setAvailable(false);
      return false;
    }
  }

  private scheduleControllerLights = () => {
    if (this.lightsFrame !== null || typeof requestAnimationFrame === 'undefined') return;
    this.lightsFrame = requestAnimationFrame(now => {
      this.lightsFrame = null;
      const settings = get(controllerLightsStore);
      const state = get(vjClipLauncher);
      this.lights.render(state, get(midiStore), settings, [...(this.access?.outputs.values() ?? [])], this.access?.sysexEnabled === true, now);
      if (settings.enabled && state.isOpen && state.pendingTriggers.length) this.scheduleControllerLights();
    });
  };

  private startControllerLights() {
    if (this.lightsSubscriptions.length || (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('mode'))) return;
    if (typeof window !== 'undefined') window.addEventListener('beforeunload', this.onWindowClose);
    if (typeof window !== 'undefined') this.quitSubscription = (window as any).electronAPI?.on?.('app-before-quit', this.onWindowClose);
    this.lightsSubscriptions = [midiStore.subscribe(this.scheduleControllerLights),
      vjClipLauncher.subscribe(this.scheduleControllerLights), controllerLightsStore.subscribe(this.scheduleControllerLights)];
  }

  async enableControllerLights(enabled: boolean) {
    const request = ++this.lightsRequest;
    controllerLightsStore.configure({ enabled: false });
    controllerLightsStore.status(enabled ? 'Connecting controller…' : 'Off');
    this.lights.clear();
    midiRouter.releaseInputs('midi:grid:'); this.gridHolds.clear();
    if (!enabled) return;
    try {
      // Device initialization requires SysEx. Ask only when the performer
      // explicitly enables controller lights; ordinary MIDI remains unchanged.
      if (!this.access?.sysexEnabled) {
        const access = await navigator.requestMIDIAccess({ sysex: true });
        if (request !== this.lightsRequest) return;
        if (this.access) this.access.onstatechange = null;
        this.detachInputs(); this.detachClockInput();
        this.access = access;
        this.access.onstatechange = () => this.refreshDevices();
        this.refreshDevices();
      }
      if (request !== this.lightsRequest) return;
      controllerLightsStore.configure({ enabled: true });
      this.startControllerLights();
    } catch (error) {
      controllerLightsStore.status(`Controller setup unavailable: ${error instanceof Error ? error.message : 'MIDI permission denied'}`);
    }
  }

  private routeControllerGrid(channel: number, type: MidiMessageType, note: number, value: number, from?: { id: string | null; name?: string }): boolean {
    if (type !== 'note') return false;
    const input = `midi:grid:${channel}:${note}`;
    const held = this.gridHolds.get(input);
    if (held && value === 0) {
      midiRouter.dispatchPath(held, 0, { inputId: input }); this.gridHolds.delete(input); return true;
    }
    const settings = get(controllerLightsStore), midi = get(midiStore), state = get(vjClipLauncher);
    if (!settings.enabled || !settings.gridInput || !state.isOpen || !state.isLive || midi.editMode || midi.identifyMode || midi.learn.active) return false;
    if (midi.mappings.some(m => m.type === type && m.number === note && (m.channel === -1 || m.channel === channel)
      && mappingHearsDevice(m, from?.name, this.inUse.controlNames))) return false;
    const outputs = [...(this.access?.outputs.values() ?? [])];
    const output = settings.outputId ? outputs.find(o => o.id === settings.outputId)
      : pairedOutput(midi.devices.find(d => d.id === midi.selectedDeviceId), outputs);
    if (!output || output.state !== 'connected') return false;
    // Only the controller showing the lights plays the grid.
    const showsLights = (id: string) => pairedOutput(midi.devices.find(d => d.id === id), [output]) === output;
    const gridInput = settings.outputId ? (this.inUse.control.find(showsLights) ?? midi.selectedDeviceId) : midi.selectedDeviceId;
    if (from?.id && gridInput && from.id !== gridInput) return false;
    const profile = controllerProfiles[settings.profile === 'auto' ? detectControllerProfile(output.name ?? '') : settings.profile];
    const cell = controllerCell(profile, note);
    if (!cell || channel !== 0) return false;
    const deck = settings.deck === 'selected' ? state.selectedDeck : settings.deck;
    if (deck === 'B' && !state.crossfaderEnabled) return true;
    const path = `${deck === 'A' ? 'vj' : 'vj-b'}:${cell[0] + settings.rowPage * profile.rows}:trigger:${cell[1] + settings.columnPage * profile.columns}`;
    if (value > 0) {
      if (held) midiRouter.dispatchPath(held, 0, { inputId: input });
      this.gridHolds.set(input, path);
      this.gridHoldsFrom = from?.id ?? null;
    }
    midiRouter.dispatchPath(path, value > 0 ? 1 : 0, { inputId: input });
    return true;
  }

  private requestMIDIAccessWithRetry(): Promise<MIDIAccess> {
    const first = navigator.requestMIDIAccess({ sysex: false });
    return Promise.race([
      first,
      new Promise<MIDIAccess>((resolve, reject) => {
        setTimeout(() => {
          navigator.requestMIDIAccess({ sysex: false }).then(resolve, reject);
        }, 1500);
      }),
    ]);
  }

  private refreshDevices() {
    if (!this.access) return;

    // Inputs
    const inputs: MidiDevice[] = [];
    this.access.inputs.forEach((input) => {
      inputs.push({
        id: input.id,
        name: input.name || 'Unknown Device',
        manufacturer: input.manufacturer || 'Unknown',
        state: input.state as 'connected' | 'disconnected',
      });
    });
    midiStore.setDevices(inputs);

    // Outputs (clock send target)
    const outputs: MidiDevice[] = [];
    this.access.outputs.forEach((output) => {
      outputs.push({
        id: output.id,
        name: output.name || 'Unknown Device',
        manufacturer: output.manufacturer || 'Unknown',
        state: output.state as 'connected' | 'disconnected',
      });
    });
    midiStore.setOutputDevices(outputs);

    let state = get(midiStore);
    const isConnected = (id: string | null | undefined) => !!id && inputs.some(d => d.id === id && d.state === 'connected');

    // The input picked before several could be is kept by name from now on.
    if (this.chosenInputId === undefined) this.chosenInputId = state.selectedDeviceId;
    const chosen = inputs.find(d => d.id === this.chosenInputId && d.state === 'connected');
    if (chosen && !setupFor(this.setups, chosen.name)) {
      this.refreshing = true;
      try {
        setMidiInputSetup(chosen.name, { use: 'control' });
      } finally {
        this.refreshing = false;
      }
      this.setups = get(midiInputSetups);
    }

    // Every controller in use, and the band's keys. While no controller is
    // plugged in the first input with no use stands in, without being
    // saved, so the chosen one takes over again when it comes back.
    const plan = resolveMidiInputs(inputs, this.setups, this.chosenInputId);
    const inputId = plan.primary ?? (isConnected(this.chosenInputId) ? null : this.chosenInputId ?? state.selectedDeviceId);
    if (inputId !== state.selectedDeviceId) {
      midiStore.selectDevice(inputId, false);
      state = get(midiStore);
    }
    this.applyInputs(plan);

    const clockInputId = state.selectedClockInputId || state.selectedDeviceId;
    if (clockInputId) {
      if (!isConnected(clockInputId)) {
        this.detachClockInput();
      } else if (!this.activeClockInput || this.activeClockInput.id !== clockInputId) {
        this.detachClockInput();
        this.attachClockInput(clockInputId);
      }
    } else {
      this.detachClockInput();
    }

    // Re-resolve the clock-send output handle if it was disconnected /
    // hot-swapped. Output dev removal silently stops the clock-out timer.
    if (state.selectedOutputId) {
      const out = outputs.find(d => d.id === state.selectedOutputId && d.state === 'connected');
      if (!out) {
        this.activeOutput = null;
        this.stopClockOut();
      } else if (!this.activeOutput || this.activeOutput.id !== state.selectedOutputId) {
        this.activeOutput = this.access.outputs.get(state.selectedOutputId) || null;
        if (state.clockOutEnabled) this.startClockOut();
      }
    }
  }

  /**
   * The user picks an input as the first controller (other controllers stay
   * in use). It is saved and followed across unplug/replug.
   */
  selectDevice(deviceId: string) {
    this.chosenInputId = deviceId;
    midiStore.selectDevice(deviceId);
    const name = this.access?.inputs.get(deviceId)?.name;
    if (name && setupFor(this.setups, name)?.use !== 'control') {
      this.refreshing = true;
      try {
        setMidiInputSetup(name, { use: 'control' });
      } finally {
        this.refreshing = false;
      }
      this.setups = get(midiInputSetups);
    }
    this.refreshDevices();
  }

  selectClockInputDevice(deviceId: string | null) {
    this.detachClockInput();
    midiStore.selectClockInput(deviceId);
    const targetId = deviceId || get(midiStore).selectedDeviceId;
    if (targetId) this.attachClockInput(targetId);
  }

  /** Public toggle for clock IN. When disabled, incoming clock bytes are
   *  ignored and stale-detection is paused. The midiStore enabled flag
   *  drives handleClockByte's early return. */
  setClockInEnabled(enabled: boolean) {
    midiStore.setClockInEnabled(enabled);
    if (!enabled) {
      this._clockTempo.reset();
      midiStore.setClockInRunning(false);
      midiStore.setClockInBPM(null);
      this.disarmClockStaleTimer();
      // Reset the BPM-bridge dedupe cache so re-enabling at the same
      // tempo gets a fresh write through to audioStore.manualBPM.
      this._clockInBpmCache = null;
    }
  }

  /** Public toggle for clock OUT. When enabled and an output device is
   *  selected, starts the tick scheduler at master BPM. */
  setClockOutEnabled(enabled: boolean) {
    midiStore.setClockOutEnabled(enabled);
    if (enabled) {
      const state = get(midiStore);
      if (state.selectedOutputId && this.access) {
        this.activeOutput = this.access.outputs.get(state.selectedOutputId) || null;
      }
      this.startClockOut();
    } else {
      this.stopClockOut();
    }
  }

  /** Listen to the inputs in use now, each for its use, and let go of the rest. */
  private applyInputs(plan: MidiInputsInUse) {
    if (!this.access) return;
    const wanted = new Map<string, InputRole>();
    for (const id of plan.control) wanted.set(id, 'control');
    for (const id of plan.keys) wanted.set(id, 'keys');
    for (const [id, entry] of [...this.inputs]) {
      if (wanted.get(id) !== entry.role || this.access.inputs.get(id) !== entry.port) this.detachInput(id);
    }
    for (const [id, role] of wanted) {
      if (this.inputs.has(id)) continue;
      const port = this.access.inputs.get(id);
      if (!port) continue;
      port.onmidimessage = this.boundMessageHandler;
      this.inputs.set(id, { port, role, name: port.name || 'Unknown Device' });
      console.log(`[MIDI] Attached to: ${port.name}${role === 'keys' ? ' (band keys)' : ''}`);
    }
    const inUse: MidiInputsInUse = { control: plan.control, keys: plan.keys, standIn: plan.standIn, controlNames: plan.controlNames };
    if (!sameInputsInUse(inUse, this.inUse)) {
      this.inUse = inUse;
      midiInputsInUse.set(inUse);
    }
  }

  /** Stop listening to one input. Whatever it holds lets go. */
  private detachInput(id: string) {
    const entry = this.inputs.get(id);
    if (!entry) return;
    this.inputs.delete(id);
    if (entry.role === 'control') {
      // Its held pads, clip gates and studio buttons (a throw) let go.
      midiRouter.releaseInputs(`midi:${id}:`);
      // The grid's held clips go only with the controller playing the grid.
      if (this.gridHolds.size && (this.gridHoldsFrom === null || this.gridHoldsFrom === id)) {
        midiRouter.releaseInputs('midi:grid:');
        this.gridHolds.clear();
      }
    } else {
      releaseBandKeys(entry.name);
    }
    if (entry.port !== this.activeClockInput) entry.port.onmidimessage = null;
  }

  private detachInputs() {
    for (const id of [...this.inputs.keys()]) this.detachInput(id);
  }

  private attachClockInput(deviceId: string) {
    if (!this.access) return;
    const input = this.access.inputs.get(deviceId);
    if (input) {
      input.onmidimessage = this.boundMessageHandler;
      this.activeClockInput = input;
      console.log(`[MIDI] Clock attached to: ${input.name}`);
    }
  }

  private detachClockInput() {
    const port = this.activeClockInput;
    if (!port) return;
    this.activeClockInput = null;
    if (this.inputs.get(port.id)?.port !== port) port.onmidimessage = null;
  }

  private handleMessage(event: MIDIMessageEvent) {
    const data = event.data;
    if (!data || data.length < 1) return;

    const status = data[0];
    const inputId = ((event.currentTarget || event.target) as MIDIInput | null)?.id ?? null;
    const state = get(midiStore);
    const clockInputId = state.selectedClockInputId || state.selectedDeviceId;

    // ===== System Real-Time messages (no channel, status byte only) =====
    // Handled BEFORE the channel/type split because their status byte's
    // upper nibble is 0xF and a lower-nibble channel mask doesn't apply.
    if (status === 0xF8 || status === 0xFA || status === 0xFB || status === 0xFC) {
      if (!clockInputId || inputId === clockInputId) {
        this.handleClockByte(status, event.timeStamp);
      }
      return;
    }

    const entry = inputId ? this.inputs.get(inputId) : undefined;
    // The band's keys play notes into the visuals; they never reach the
    // mappings or MIDI learn.
    if (entry?.role === 'keys') {
      const setup = setupFor(this.setups, entry.name);
      if (setup) emitBandKeys(data, setup);
      return;
    }
    // An input listened to only for its clock controls nothing.
    if (inputId && entry?.role !== 'control') return;
    const from = { id: inputId, name: entry?.name };

    if (data.length < 2) return;
    const channel = status & 0x0F;
    const msgType = status & 0xF0;

    let type: MidiMessageType;
    let number: number;
    let value: number;

    switch (msgType) {
      case 0xB0: // Control Change
        type = 'cc';
        number = data[1];
        value = data[2];
        break;
      case 0x90: // Note On
        type = 'note';
        number = data[1];
        value = data[2]; // velocity, 0 = note off
        break;
      case 0x80: // Note Off
        type = 'note';
        number = data[1];
        value = 0;
        break;
      case 0xE0: // Pitch Bend
        type = 'pitchbend';
        number = 0;
        value = (data[2] << 7) | data[1]; // 14-bit
        break;
      default:
        return; // Ignore sysex, active sensing, etc.
    }

    // Update last message for display (throttled — see field docs above)
    const nowMs = performance.now();
    if (nowMs - this._lastMsgTs >= MidiManager._LAST_MSG_MIN_INTERVAL_MS) {
      this._lastMsgTs = nowMs;
      midiStore.setLastMessage({ channel, type, number, value });
    }

    // A held pad must release its original deck/page even after navigation.
    if (this.routeControllerGrid(channel, type, number, value, from)) return;

    // Check if we're in learn mode
    if (state.learn.active && state.learn.targetPath) {
      // For note messages, only learn on Note On (velocity > 0)
      if (type === 'note' && value === 0) return;
      midiStore.completeLearn(channel, type, number, from.name);
      return;
    }

    // Route to parameter updates. Suppressed in edit mode to avoid
    // unintended changes while mapping, and in identify mode, where the user
    // is pressing a control precisely to find out what it is bound to: firing
    // all of it at them would be the opposite of what they asked for.
    if (!state.editMode && !state.identifyMode) {
      midiRouter.routeMessage(channel, type, number, value, from);
    }
  }

  /** Process a System Real-Time clock byte (0xF8 tick / 0xFA start /
   *  0xFB continue / 0xFC stop). Drives audioStore BPM via midiStore.
   *  Silently no-ops when clock-in is disabled in settings — saves the
   *  tick math overhead for users who don't sync over MIDI. */
  private handleClockByte(status: number, timeStamp?: number) {
    const state = get(midiStore);
    if (!state.clockInEnabled) return;

    // The event's own time, not when this handler got to run: a busy main
    // thread delivers ticks in bursts.
    const now = typeof timeStamp === 'number' && Number.isFinite(timeStamp) && timeStamp > 0 ? timeStamp : performance.now();

    if (status === 0xFA) {
      // Start: reset tick history so the first measured BPM is from the
      // new transport, not the old one.
      this._clockTempo.restart();
      midiStore.setClockInRunning(true);
      this.armClockStaleTimer();
      return;
    }
    if (status === 0xFB) {
      // Continue: mark running but don't reset history (DAW resumes mid-bar)
      midiStore.setClockInRunning(true);
      this.armClockStaleTimer();
      return;
    }
    if (status === 0xFC) {
      // Stop: don't clear BPM (last tempo stays as a hint), just mark stopped.
      midiStore.setClockInRunning(false);
      this.disarmClockStaleTimer();
      return;
    }

    // 0xF8: tick (24 PPQN). Publish only real tempo changes.
    const bpm = this._clockTempo.tick(now);
    if (bpm !== null) midiStore.setClockInBPM(bpm);

    // Mark running on first tick (some devices don't send 0xFA before ticks)
    if (!state.clockInRunning) midiStore.setClockInRunning(true);
    this.armClockStaleTimer();
  }

  /** Reset/start the "no tick for >500ms = stopped" watchdog. Avoids a
   *  stale BPM lingering on screen after a DAW silently disconnects. */
  private armClockStaleTimer() {
    if (this._clockStaleTimer !== null) clearTimeout(this._clockStaleTimer);
    this._clockStaleTimer = setTimeout(() => {
      midiStore.setClockInRunning(false);
      this._clockStaleTimer = null;
    }, this._clockStalePeriodMs);
  }
  private disarmClockStaleTimer() {
    if (this._clockStaleTimer !== null) {
      clearTimeout(this._clockStaleTimer);
      this._clockStaleTimer = null;
    }
  }

  /** Public: select an output device for clock send (and any future
   *  outbound MIDI like CC echoes). Persists the choice in midiStore.
   *  Caller separately toggles `clockOutEnabled` in midiStore to actually
   *  start ticking. */
  selectOutputDevice(deviceId: string | null) {
    midiStore.selectOutput(deviceId);
    if (!deviceId) {
      this.activeOutput = null;
      this.stopClockOut();
      return;
    }
    if (!this.access) return;
    this.activeOutput = this.access.outputs.get(deviceId) || null;
    const state = get(midiStore);
    if (state.clockOutEnabled) this.startClockOut();
  }

  /** Begin emitting MIDI Start (0xFA) + ticks (0xF8) at 24 PPQN at the
   *  current master BPM. Tempo source priority is delegated to the BPM
   *  resolver below — when audio detects a tempo it follows that, when
   *  the user taps a tempo it follows the manual override, etc. */
  startClockOut() {
    if (!this.activeOutput) {
      console.warn('[MIDI] Clock OUT requested but no output device selected');
      return;
    }
    this.stopClockOut(); // idempotent — start clean
    try {
      this.activeOutput.send([0xFA]); // Start
    } catch (err) {
      console.warn('[MIDI] Clock OUT Start send failed:', err);
    }
    this._clockOutLastSendMs = performance.now();
    this.scheduleNextOutTick();
  }

  /** Stop ticking and send a 0xFC Stop. Safe to call even if not running. */
  stopClockOut() {
    if (this._clockOutTimer !== null) {
      clearTimeout(this._clockOutTimer);
      this._clockOutTimer = null;
    }
    if (this.activeOutput) {
      try { this.activeOutput.send([0xFC]); } catch { /* device gone, ignore */ }
    }
  }

  /** Recursively schedule the NEXT clock-out tick. Reads the current
   *  master BPM each iteration so tempo changes propagate within one tick.
   *  Source priority: midiStore.clockInBPM (mirrors incoming clock if
   *  user wants throughput) > audioStore.manualBPM > audioStore.bpm > 120. */
  private scheduleNextOutTick() {
    if (!this.activeOutput) return;
    const state = get(midiStore);
    if (!state.clockOutEnabled) return;

    // Resolve current BPM. We call this every tick so tempo changes
    // propagate within ~one PPQN interval.
    const bpm = this.resolveMasterBPM();
    const tickIntervalMs = 60000 / (MidiManager._CLOCK_PPQN * bpm);

    this._clockOutTimer = window.setTimeout(() => {
      try {
        this.activeOutput!.send([0xF8]); // Tick
        this._clockOutLastSendMs = performance.now();
      } catch (err) {
        console.warn('[MIDI] Clock OUT tick send failed:', err);
      }
      this.scheduleNextOutTick();
    }, tickIntervalMs);
  }

  /** Master BPM resolver — used by clock-out scheduling. Reads in
   *  priority order: midi-clock-in (if running) → user tap → auto-detect
   *  → fallback. Called every tick so tempo changes propagate within one
   *  PPQN interval. */
  private resolveMasterBPM(): number {
    const midiState = get(midiStore);
    if (midiState.clockInRunning && midiState.clockInBPM) return midiState.clockInBPM;
    const audio = get(audioStore);
    if (audio.manualBPM) return audio.manualBPM;
    if (audio.bpm) return audio.bpm;
    return 120;
  }

  destroy() {
    this.quitSubscription?.(); this.quitSubscription = undefined;
    if (typeof window !== 'undefined') window.removeEventListener('beforeunload', this.onWindowClose);
    this.clockSubscription?.(); this.clockSubscription = undefined;
    this.setupsSubscription?.(); this.setupsSubscription = undefined;
    this.detachClockInput();
    ++this.lightsRequest;
    this.lightsSubscriptions.splice(0).forEach(unsubscribe => unsubscribe());
    if (this.lightsFrame !== null) cancelAnimationFrame(this.lightsFrame);
    this.lightsFrame = null;
    this.lights.clear();
    this.detachInputs();
    this.stopClockOut();
    this.disarmClockStaleTimer();
    if (this.access) {
      this.access.onstatechange = null;
    }
  }
}

export const midiManager = new MidiManager();
