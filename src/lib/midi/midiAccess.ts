// Where MIDI comes from: Web MIDI (the default) or the native backend in the
// main process (electron/native-midi.cjs), opted into with the "Native MIDI"
// setting or GA_NATIVE_MIDI=1.
//
// The native backend is wrapped in objects shaped like Web MIDI's MIDIAccess,
// MIDIInput and MIDIOutput, so the manager, router, lights, program change and
// timecode code see the same ports, messages and statechange events whichever
// backend is active. What it adds: "Ghost Arcade" virtual ports other apps can
// connect to (macOS), and message times taken by the OS driver thread.

import { writable } from 'svelte/store';
import { hasElectronEventApi, invoke, onElectronEvent } from '$lib/bridge';

export interface NativeMidiPortInfo {
  id: string;
  name: string;
  manufacturer: string;
  virtual?: boolean;
}

export interface NativeMidiPortList {
  inputs: NativeMidiPortInfo[];
  outputs: NativeMidiPortInfo[];
}

/** One message as the main process sends it. `t` is epoch milliseconds. */
export interface NativeMidiWireMessage {
  port: string;
  data: Uint8Array | number[];
  t: number;
}

export interface NativeMidiStatus {
  available: boolean;
  envOptIn: boolean;
  virtualPortsSupported?: boolean;
  error?: string | null;
}

/** What the native session needs from the main process (faked in tests). */
export interface NativeMidiBackend {
  status(): Promise<NativeMidiStatus>;
  start(): Promise<{ ok: boolean; virtual?: boolean; ports?: NativeMidiPortList; error?: string }>;
  send(id: string, data: Uint8Array): void;
  onMessages(callback: (messages: NativeMidiWireMessage[]) => void): () => void;
  onPorts(callback: (ports: NativeMidiPortList) => void): () => void;
  /** Epoch time of this page's performance.now() zero. */
  timeOrigin(): number;
}

export const NATIVE_MIDI_SETTING_KEY = 'ghost-arcade_native_midi';

export function nativeMidiSetting(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(NATIVE_MIDI_SETTING_KEY) === '1';
  } catch {
    return false;
  }
}

/** Saved for the next launch: the backend is picked once, at startup. */
export function setNativeMidiSetting(on: boolean): void {
  try {
    if (on) localStorage.setItem(NATIVE_MIDI_SETTING_KEY, '1');
    else localStorage.removeItem(NATIVE_MIDI_SETTING_KEY);
  } catch { /* private storage: the setting just does not stick */ }
  midiBackendInfo.update((s) => ({ ...s, setting: on }));
}

export interface MidiBackendInfo {
  /** The backend in use, once decided. */
  backend: 'web' | 'native' | null;
  /** The native addon loads in this build. */
  nativeAvailable: boolean;
  /** "Ghost Arcade" virtual in/out exist (native on macOS). */
  virtualPorts: boolean;
  setting: boolean;
  envOptIn: boolean;
  error: string | null;
}

export const midiBackendInfo = writable<MidiBackendInfo>({
  backend: null, nativeAvailable: false, virtualPorts: false, setting: nativeMidiSetting(), envOptIn: false, error: null,
});

// ---- Web MIDI-shaped wrappers -------------------------------------------------

function connectionEvent(port: NativeMidiPort): Event {
  const ev = new Event('statechange');
  Object.defineProperty(ev, 'port', { value: port });
  return ev;
}

function messageEvent(data: Uint8Array, timeStamp: number): Event {
  const ev = new Event('midimessage');
  Object.defineProperty(ev, 'data', { value: data });
  // Like Web MIDI: when the message arrived, on performance.now()'s clock.
  Object.defineProperty(ev, 'timeStamp', { value: timeStamp });
  return ev;
}

type Handler = ((this: any, ev: any) => any) | null;

abstract class NativeMidiPort extends EventTarget {
  readonly id: string;
  readonly name: string;
  readonly manufacturer: string;
  readonly version = '';
  abstract readonly type: 'input' | 'output';
  state: 'connected' | 'disconnected' = 'connected';
  connection: 'open' | 'closed' | 'pending' = 'closed';
  readonly virtual: boolean;
  private stateHandler: Handler = null;

  constructor(info: NativeMidiPortInfo) {
    super();
    this.id = info.id;
    this.name = info.name;
    this.manufacturer = info.manufacturer;
    this.virtual = !!info.virtual;
  }

  get onstatechange(): Handler { return this.stateHandler; }
  set onstatechange(handler: Handler) {
    if (this.stateHandler) this.removeEventListener('statechange', this.stateHandler);
    this.stateHandler = typeof handler === 'function' ? handler : null;
    if (this.stateHandler) this.addEventListener('statechange', this.stateHandler);
  }

  async open(): Promise<this> {
    if (this.state === 'connected') this.connection = 'open';
    return this;
  }

  async close(): Promise<this> {
    this.connection = 'closed';
    return this;
  }
}

export class NativeMidiInput extends NativeMidiPort {
  readonly type = 'input' as const;
  private messageHandler: Handler = null;
  private listeners = new Set<EventListenerOrEventListenerObject>();

  get onmidimessage(): Handler { return this.messageHandler; }
  set onmidimessage(handler: Handler) {
    if (this.messageHandler) this.removeEventListener('midimessage', this.messageHandler);
    this.messageHandler = typeof handler === 'function' ? handler : null;
    if (this.messageHandler) this.addEventListener('midimessage', this.messageHandler);
  }

  override addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void {
    super.addEventListener(type, listener, options);
    // Web MIDI opens an input when something listens to it.
    if (type === 'midimessage' && listener) {
      this.listeners.add(listener);
      if (this.state === 'connected') this.connection = 'open';
    }
  }

  override removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions): void {
    super.removeEventListener(type, listener, options);
    if (type === 'midimessage' && listener) this.listeners.delete(listener);
  }

  /** @internal */
  hasListeners(): boolean { return this.listeners.size > 0; }
}

export class NativeMidiOutput extends NativeMidiPort {
  readonly type = 'output' as const;

  constructor(info: NativeMidiPortInfo, private readonly access: NativeMidiAccess) {
    super(info);
  }

  send(data: number[] | Uint8Array, timestamp?: number): void {
    const bytes = data instanceof Uint8Array ? data : Uint8Array.from(data);
    for (let i = 0; i < data.length; i++) {
      const b = data[i];
      if (!Number.isInteger(b) || b < 0 || b > 255) throw new TypeError(`MIDI byte out of range at ${i}: ${b}`);
    }
    if (!this.access.sysexEnabled && bytes.includes(0xF0)) {
      throw new DOMException('System exclusive message is not allowed', 'InvalidAccessError');
    }
    if (this.state !== 'connected') throw new DOMException('Port is disconnected', 'InvalidStateError');
    this.connection = 'open';
    const delay = typeof timestamp === 'number' && timestamp > 0 ? timestamp - performance.now() : 0;
    if (delay > 1) setTimeout(() => this.access.sendRaw(this.id, bytes), delay);
    else this.access.sendRaw(this.id, bytes);
  }

  clear(): void { /* sends are not queued here */ }
}

/** A MIDIAccess over the native session. Each request gets its own, as in Web MIDI. */
export class NativeMidiAccess extends EventTarget {
  readonly inputs = new Map<string, NativeMidiInput>();
  readonly outputs = new Map<string, NativeMidiOutput>();
  private stateHandler: Handler = null;

  constructor(readonly sysexEnabled: boolean, private readonly session: NativeMidiSession, ports: NativeMidiPortList) {
    super();
    this.applyPorts(ports, false);
  }

  get onstatechange(): Handler { return this.stateHandler; }
  set onstatechange(handler: Handler) {
    if (this.stateHandler) this.removeEventListener('statechange', this.stateHandler);
    this.stateHandler = typeof handler === 'function' ? handler : null;
    if (this.stateHandler) this.addEventListener('statechange', this.stateHandler);
  }

  /** @internal */
  sendRaw(id: string, data: Uint8Array): void { this.session.send(id, data); }

  /** @internal New port list: ports come, go (kept, as disconnected) and come back. */
  applyPorts(list: NativeMidiPortList, notify = true): void {
    const changed: NativeMidiPort[] = [];
    const sync = <P extends NativeMidiPort>(map: Map<string, P>, infos: NativeMidiPortInfo[], make: (info: NativeMidiPortInfo) => P) => {
      const present = new Set<string>();
      for (const info of infos) {
        present.add(info.id);
        const port = map.get(info.id);
        if (!port) {
          const created = make(info);
          map.set(info.id, created);
          changed.push(created);
        } else if (port.state !== 'connected') {
          port.state = 'connected';
          changed.push(port);
        }
      }
      for (const port of map.values()) {
        if (!present.has(port.id) && port.state === 'connected') {
          port.state = 'disconnected';
          port.connection = 'closed';
          changed.push(port);
        }
      }
    };
    sync(this.inputs, list.inputs, (info) => new NativeMidiInput(info));
    sync(this.outputs, list.outputs, (info) => new NativeMidiOutput(info, this));
    if (!notify) return;
    for (const port of changed) {
      port.dispatchEvent(connectionEvent(port));
      this.dispatchEvent(connectionEvent(port));
    }
  }

  /** @internal */
  deliver(portId: string, data: Uint8Array, timeStamp: number): void {
    const input = this.inputs.get(portId);
    if (!input || input.state !== 'connected' || !input.hasListeners()) return;
    // Without SysEx permission Web MIDI never delivers SysEx.
    if (data[0] === 0xF0 && !this.sysexEnabled) return;
    input.dispatchEvent(messageEvent(data, timeStamp));
  }
}

/** The one native connection of this page, shared by every MIDIAccess. */
export class NativeMidiSession {
  private ports: NativeMidiPortList = { inputs: [], outputs: [] };
  private accesses = new Set<WeakRef<NativeMidiAccess>>();
  private unsubscribe: (() => void)[] = [];
  private started: Promise<boolean> | null = null;
  virtualPorts = false;
  error: string | null = null;

  constructor(private readonly backend: NativeMidiBackend) {}

  start(): Promise<boolean> {
    if (!this.started) {
      this.started = (async () => {
        // Listen first: nothing between start and the first event is lost.
        this.unsubscribe.push(this.backend.onMessages((messages) => this.onMessages(messages)));
        this.unsubscribe.push(this.backend.onPorts((ports) => this.onPorts(ports)));
        let result: Awaited<ReturnType<NativeMidiBackend['start']>>;
        try {
          result = await this.backend.start();
        } catch (err) {
          result = { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
        if (!result.ok) {
          this.error = result.error ?? 'native MIDI failed to start';
          this.unsubscribe.splice(0).forEach((u) => u());
          return false;
        }
        this.virtualPorts = !!result.virtual;
        if (result.ports) this.ports = result.ports;
        return true;
      })();
    }
    return this.started;
  }

  access(sysex: boolean): NativeMidiAccess {
    const access = new NativeMidiAccess(sysex, this, this.ports);
    this.accesses.add(new WeakRef(access));
    return access;
  }

  send(id: string, data: Uint8Array): void {
    this.backend.send(id, data);
  }

  private each(fn: (access: NativeMidiAccess) => void) {
    for (const ref of this.accesses) {
      const access = ref.deref();
      if (access) fn(access);
      else this.accesses.delete(ref);
    }
  }

  private onPorts(ports: NativeMidiPortList) {
    this.ports = ports;
    this.each((access) => access.applyPorts(ports));
  }

  private onMessages(messages: NativeMidiWireMessage[]) {
    const origin = this.backend.timeOrigin();
    for (const m of messages) {
      const data = m.data instanceof Uint8Array ? m.data : Uint8Array.from(m.data);
      const timeStamp = Number.isFinite(m.t) ? m.t - origin : performance.now();
      this.each((access) => access.deliver(m.port, data, timeStamp));
    }
  }

  dispose(): void {
    this.unsubscribe.splice(0).forEach((u) => u());
    this.accesses.clear();
  }
}

// ---- Picking the backend ------------------------------------------------------

function electronBackend(): NativeMidiBackend | null {
  if (!hasElectronEventApi()) return null;
  return {
    status: () => invoke<NativeMidiStatus>('native_midi_status'),
    start: () => invoke('native_midi_start'),
    send: (id, data) => { void invoke('native_midi_send', { id, data }).catch(() => {}); },
    onMessages: (cb) => onElectronEvent('native-midi-messages', cb) ?? (() => {}),
    onPorts: (cb) => onElectronEvent('native-midi-ports', cb) ?? (() => {}),
    timeOrigin: () => performance.timeOrigin,
  };
}

let backendFactory: () => NativeMidiBackend | null = electronBackend;
let nativeDecision: Promise<NativeMidiSession | null> | null = null;

/** Tests: use this backend (null: none) and decide again. */
export function setNativeMidiBackendForTests(factory: (() => NativeMidiBackend | null) | null): void {
  backendFactory = factory ?? electronBackend;
  nativeDecision = null;
}

function nativeSession(): Promise<NativeMidiSession | null> {
  if (!nativeDecision) {
    nativeDecision = (async () => {
      const backend = backendFactory();
      if (!backend) return null;
      let status: NativeMidiStatus | null = null;
      try {
        status = await backend.status();
      } catch {
        status = null;
      }
      const setting = nativeMidiSetting();
      const wanted = !!status?.envOptIn || setting;
      midiBackendInfo.update((s) => ({ ...s, nativeAvailable: !!status?.available, envOptIn: !!status?.envOptIn, setting }));
      if (!wanted) return null;
      if (!status?.available) {
        console.warn(`[MIDI] Native MIDI asked for but not available (${status?.error ?? 'no addon'}); using Web MIDI`);
        midiBackendInfo.update((s) => ({ ...s, error: status?.error ?? 'Native MIDI is not available in this build' }));
        return null;
      }
      const session = new NativeMidiSession(backend);
      if (!(await session.start())) {
        console.warn(`[MIDI] Native MIDI failed to start (${session.error}); using Web MIDI`);
        midiBackendInfo.update((s) => ({ ...s, error: session.error }));
        return null;
      }
      midiBackendInfo.update((s) => ({ ...s, virtualPorts: session.virtualPorts, error: null }));
      return session;
    })();
  }
  return nativeDecision;
}

function webMidiAvailable(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';
}

/** MIDI can be asked for here, through one backend or the other. */
export function midiAccessPossible(): boolean {
  return webMidiAvailable() || !!backendFactory();
}

/**
 * Web MIDI's first request can hang in a packaged macOS build (the grant is
 * never observed); a second request after 1.5 s resolves from the cached
 * permission, so whichever settles first wins.
 */
function requestWebMidiWithRetry(options: MIDIOptions): Promise<MIDIAccess> {
  const first = navigator.requestMIDIAccess(options);
  return Promise.race([
    first,
    new Promise<MIDIAccess>((resolve, reject) => {
      setTimeout(() => { navigator.requestMIDIAccess(options).then(resolve, reject); }, 1500);
    }),
  ]);
}

/**
 * A MIDIAccess from the active backend. Native when it is opted into and
 * starts; otherwise Web MIDI, which stays the default and the fallback.
 */
export async function requestMidiAccess(options: MIDIOptions = {}, { retryHang = false } = {}): Promise<MIDIAccess> {
  const session = await nativeSession();
  if (session) {
    midiBackendInfo.update((s) => (s.backend === 'native' ? s : { ...s, backend: 'native' }));
    return session.access(!!options.sysex) as unknown as MIDIAccess;
  }
  if (!webMidiAvailable()) throw new Error('Web MIDI is not available');
  midiBackendInfo.update((s) => (s.backend === 'web' ? s : { ...s, backend: 'web' }));
  return retryHang ? requestWebMidiWithRetry(options) : navigator.requestMIDIAccess(options);
}
