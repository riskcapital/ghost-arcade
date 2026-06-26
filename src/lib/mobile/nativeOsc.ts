import type { StandaloneOscBinding } from './standaloneOsc';

export type NativeOscStatus = 'unavailable' | 'idle' | 'starting' | 'listening' | 'error';

export interface NativeOscArg {
  type?: string;
  value?: number | string | boolean;
}

export interface NativeOscMessage {
  address: string;
  args: unknown[];
  from?: string;
  port?: number;
  receivedAt?: number;
}

export interface NativeOscStatusEvent {
  listening: boolean;
  port: number;
  error?: string;
}

type PluginListenerHandle = { remove: () => Promise<void> | void };

type GhostOscNativePlugin = {
  start(options: { port: number }): Promise<NativeOscStatusEvent>;
  stop(): Promise<NativeOscStatusEvent>;
  status(): Promise<NativeOscStatusEvent>;
  addListener(eventName: 'message', cb: (message: NativeOscMessage) => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'status', cb: (status: NativeOscStatusEvent) => void): Promise<PluginListenerHandle>;
};

export interface StandaloneNativeOscOptions {
  bindings: () => StandaloneOscBinding[];
  onMessage: (message: NativeOscMessage) => void;
  onStatus: (status: NativeOscStatus, event?: NativeOscStatusEvent) => void;
}

function nativePlugin(): GhostOscNativePlugin | null {
  if (typeof window === 'undefined') return null;
  const win = window as any;
  const cap = win.Capacitor;
  if (!win.GhostOsc && cap?.registerPlugin && cap?.isPluginAvailable?.('GhostOsc')) {
    win.GhostOsc = cap.registerPlugin('GhostOsc');
  }
  return win.GhostOsc
    ?? cap?.Plugins?.GhostOsc
    ?? null;
}

export function isNativeOscBridgeAvailable(): boolean {
  const plugin = nativePlugin();
  return !!plugin && typeof plugin.start === 'function' && typeof plugin.addListener === 'function';
}

export function normalizeNativeOscArgs(args: unknown[] | undefined): unknown[] {
  if (!Array.isArray(args)) return [];
  return args.map((arg: any) => {
    if (arg && typeof arg === 'object' && 'value' in arg) return arg.value;
    return arg;
  });
}

export class StandaloneNativeOsc {
  private plugin: GhostOscNativePlugin | null = null;
  private handles: PluginListenerHandle[] = [];
  private opts: StandaloneNativeOscOptions;
  public status: NativeOscStatus = isNativeOscBridgeAvailable() ? 'idle' : 'unavailable';
  public port = 0;
  public error: string | null = null;

  constructor(opts: StandaloneNativeOscOptions) {
    this.opts = opts;
  }

  async start(port = 8000): Promise<void> {
    this.plugin = nativePlugin();
    if (!this.plugin) {
      this.setStatus('unavailable');
      return;
    }
    await this.attachListeners();
    this.setStatus('starting', { listening: false, port });
    try {
      const status = await this.plugin.start({ port });
      this.applyStatus(status);
    } catch (err: any) {
      const message = err?.message ?? 'Could not start OSC';
      this.error = message;
      this.setStatus('error', { listening: false, port, error: message });
    }
  }

  async stop(): Promise<void> {
    if (!this.plugin) {
      this.setStatus(isNativeOscBridgeAvailable() ? 'idle' : 'unavailable');
      return;
    }
    try {
      const status = await this.plugin.stop();
      this.applyStatus(status);
    } catch (err: any) {
      const message = err?.message ?? 'Could not stop OSC';
      this.error = message;
      this.setStatus('error', { listening: false, port: this.port, error: message });
    }
  }

  async dispose(): Promise<void> {
    await this.stop();
    const handles = this.handles.splice(0);
    await Promise.all(handles.map(h => Promise.resolve(h.remove()).catch(() => undefined)));
    this.plugin = null;
  }

  private async attachListeners(): Promise<void> {
    if (!this.plugin || this.handles.length > 0) return;
    const messageHandle = await this.plugin.addListener('message', (message) => {
      this.opts.onMessage({
        ...message,
        args: normalizeNativeOscArgs(message.args),
      });
    });
    const statusHandle = await this.plugin.addListener('status', status => this.applyStatus(status));
    this.handles.push(messageHandle, statusHandle);
  }

  private applyStatus(event: NativeOscStatusEvent): void {
    this.port = event.port ?? this.port;
    this.error = event.error ?? null;
    this.setStatus(event.listening ? 'listening' : this.error ? 'error' : 'idle', event);
  }

  private setStatus(status: NativeOscStatus, event?: NativeOscStatusEvent): void {
    this.status = status;
    this.opts.onStatus(status, event);
  }
}
