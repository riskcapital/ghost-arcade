// MIDI Manager - Web MIDI API wrapper with device detection and hot-plug
import { midiStore } from './midiStore';
import { midiRouter } from './midiRouter';
import { audioStore } from '../stores/audio';
import type { MidiDevice, MidiMessageType } from './midiTypes';
import { get } from 'svelte/store';

class MidiManager {
  private access: MIDIAccess | null = null;
  private activeInput: MIDIInput | null = null;
  private activeOutput: MIDIOutput | null = null;
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
  // 24 PPQN means 24 ticks per quarter note. We measure intervals between
  // consecutive 0xF8 ticks, average across the last N, and convert to BPM.
  // Reset on 0xFA Start so the first beat after Start is clean.
  private _clockTickTimes: number[] = [];
  private static _CLOCK_TICK_AVG_WINDOW = 48; // 2 quarter notes — fast lock + stable
  private static _CLOCK_PPQN = 24;
  // Stop processing ticks if the device sends them out of spec (more than
  // ~300 BPM or less than ~30 BPM). Keeps audioStore.bpm sane against bad
  // hardware or test signals.
  private static _CLOCK_BPM_MIN = 30;
  private static _CLOCK_BPM_MAX = 300;
  // Stale-detection: if no tick arrives for >500ms we mark clock-in as
  // stopped so the BPM readout doesn't keep reporting the last known value.
  private _clockStaleTimer: number | null = null;
  private _clockStalePeriodMs = 500;

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
      midiStore.subscribe(s => {
        if (!s.clockInEnabled) return;
        if (s.clockInRunning && s.clockInBPM != null && s.clockInBPM !== this._clockInBpmCache) {
          this._clockInBpmCache = s.clockInBPM;
          audioStore.setManualBPM(s.clockInBPM);
        }
      });

      console.log('[MIDI] Initialized successfully');
      return true;
    } catch (err) {
      console.error('[MIDI] Failed to get MIDI access:', err);
      midiStore.setAvailable(false);
      return false;
    }
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

    const state = get(midiStore);

    // If selected input disconnected, detach listener
    if (state.selectedDeviceId) {
      const dev = inputs.find(d => d.id === state.selectedDeviceId);
      if (!dev || dev.state === 'disconnected') {
        this.detachInput();
      } else if (!this.activeInput || this.activeInput.id !== state.selectedDeviceId) {
        // Device reconnected — reattach
        this.attachInput(state.selectedDeviceId);
      }
    }

    // Auto-select first input if none selected (or try remembered device)
    if (!state.selectedDeviceId || !inputs.find(d => d.id === state.selectedDeviceId && d.state === 'connected')) {
      const firstConnected = inputs.find(d => d.state === 'connected');
      if (firstConnected) {
        this.selectDevice(firstConnected.id);
      }
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

  selectDevice(deviceId: string) {
    this.detachInput();
    midiStore.selectDevice(deviceId);
    this.attachInput(deviceId);
  }

  /** Public toggle for clock IN. When disabled, incoming clock bytes are
   *  ignored and stale-detection is paused. The midiStore enabled flag
   *  drives handleClockByte's early return. */
  setClockInEnabled(enabled: boolean) {
    midiStore.setClockInEnabled(enabled);
    if (!enabled) {
      this._clockTickTimes = [];
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

  private attachInput(deviceId: string) {
    if (!this.access) return;
    const input = this.access.inputs.get(deviceId);
    if (input) {
      input.onmidimessage = this.boundMessageHandler;
      this.activeInput = input;
      console.log(`[MIDI] Attached to: ${input.name}`);
    }
  }

  private detachInput() {
    if (this.activeInput) {
      this.activeInput.onmidimessage = null;
      this.activeInput = null;
    }
  }

  private handleMessage(event: MIDIMessageEvent) {
    const data = event.data;
    if (!data || data.length < 1) return;

    const status = data[0];

    // ===== System Real-Time messages (no channel, status byte only) =====
    // Handled BEFORE the channel/type split because their status byte's
    // upper nibble is 0xF and a lower-nibble channel mask doesn't apply.
    if (status === 0xF8 || status === 0xFA || status === 0xFB || status === 0xFC) {
      this.handleClockByte(status);
      return;
    }

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

    // Check if we're in learn mode
    const state = get(midiStore);
    if (state.learn.active && state.learn.targetPath) {
      // For note messages, only learn on Note On (velocity > 0)
      if (type === 'note' && value === 0) return;
      midiStore.completeLearn(channel, type, number);
      return;
    }

    // Route to parameter updates (only when NOT in edit mode to avoid unintended changes while mapping)
    if (!state.editMode) {
      midiRouter.routeMessage(channel, type, number, value);
    }
  }

  /** Process a System Real-Time clock byte (0xF8 tick / 0xFA start /
   *  0xFB continue / 0xFC stop). Drives audioStore BPM via midiStore.
   *  Silently no-ops when clock-in is disabled in settings — saves the
   *  tick math overhead for users who don't sync over MIDI. */
  private handleClockByte(status: number) {
    const state = get(midiStore);
    if (!state.clockInEnabled) return;

    const now = performance.now();

    if (status === 0xFA) {
      // Start: reset tick history so the first measured BPM is from the
      // new transport, not the old one.
      this._clockTickTimes = [];
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

    // 0xF8: tick (24 PPQN)
    this._clockTickTimes.push(now);
    if (this._clockTickTimes.length > MidiManager._CLOCK_TICK_AVG_WINDOW) {
      this._clockTickTimes.shift();
    }

    // Need at least 2 samples for an interval. Compute BPM from the
    // average tick interval over the window.
    if (this._clockTickTimes.length >= 2) {
      const first = this._clockTickTimes[0];
      const last = this._clockTickTimes[this._clockTickTimes.length - 1];
      const intervals = this._clockTickTimes.length - 1;
      const avgTickMs = (last - first) / intervals;
      // 24 ticks per quarter, 60s per minute → BPM = 60000 / (24 * avgTickMs)
      const bpm = 60000 / (MidiManager._CLOCK_PPQN * avgTickMs);
      if (bpm >= MidiManager._CLOCK_BPM_MIN && bpm <= MidiManager._CLOCK_BPM_MAX) {
        // Round to 1 decimal so the readout doesn't jitter on every tick
        midiStore.setClockInBPM(Math.round(bpm * 10) / 10);
      }
    }

    // Mark running on first tick (some devices don't send 0xFA before ticks)
    if (!state.clockInRunning) midiStore.setClockInRunning(true);
    this.armClockStaleTimer();
  }

  /** Reset/start the "no tick for >500ms = stopped" watchdog. Avoids a
   *  stale BPM lingering on screen after a DAW silently disconnects. */
  private armClockStaleTimer() {
    if (this._clockStaleTimer !== null) clearTimeout(this._clockStaleTimer);
    this._clockStaleTimer = window.setTimeout(() => {
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
    this.detachInput();
    this.stopClockOut();
    this.disarmClockStaleTimer();
    if (this.access) {
      this.access.onstatechange = null;
    }
  }
}

export const midiManager = new MidiManager();
