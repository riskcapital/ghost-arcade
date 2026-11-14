export type OutputRotation = 0 | 90 | 180 | 270;
/** How the 16:9 program sits on a display of another shape: whole picture, fill and crop, or stretched to every edge. */
export type OutputFit = 'contain' | 'cover' | 'fill';
export type DisplayMode = { width: number; height: number };
export type OutputPreferences = {
  method: 'wireless' | 'wired';
  frameRate: 30 | 60;
  enabled: boolean;
  /** Turns the picture for a projector mounted on its side or upside down. */
  rotation: OutputRotation;
  /** Mirrors the picture left to right, for projecting from behind a screen. */
  mirror: boolean;
  fit: OutputFit;
  /** Use every pixel of the display. Off leaves the margin iOS keeps for TVs that crop their edges. */
  fullFrame: boolean;
  /** A display mode the person chose; null lets the display pick its own. */
  mode: DisplayMode | null;
};
export const OUTPUT_PREFERENCES_KEY = 'ga-mobile-output-v1';
const ROTATIONS: OutputRotation[] = [0, 90, 180, 270];
const FITS: OutputFit[] = ['contain', 'cover', 'fill'];
export const defaultOutputPreferences = (): OutputPreferences => ({ method: 'wireless', frameRate: 30, enabled: true, rotation: 0, mirror: false, fit: 'contain', fullFrame: true, mode: null });
/** Reads saved output choices. Choices saved by app 1.1 (method, frame rate, on/off) keep their values; the rest start at their defaults. */
export function normalizeOutputPreferences(raw: unknown): OutputPreferences {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const base = defaultOutputPreferences();
  const mode = p.mode as Partial<DisplayMode> | null | undefined;
  const validMode = !!mode && typeof mode === 'object' && Number.isInteger(mode.width) && Number.isInteger(mode.height) && mode.width! > 0 && mode.height! > 0 && mode.width! <= 8192 && mode.height! <= 8192;
  return {
    method: p.method === 'wired' ? 'wired' : 'wireless',
    frameRate: p.frameRate === 60 ? 60 : 30,
    enabled: p.enabled !== false,
    rotation: ROTATIONS.includes(p.rotation as OutputRotation) ? (p.rotation as OutputRotation) : base.rotation,
    mirror: p.mirror === true,
    fit: FITS.includes(p.fit as OutputFit) ? (p.fit as OutputFit) : base.fit,
    fullFrame: p.fullFrame !== false,
    mode: validMode ? { width: mode!.width!, height: mode!.height! } : null,
  };
}
export function loadOutputPreferences(): OutputPreferences {
  try { return normalizeOutputPreferences(JSON.parse(localStorage.getItem(OUTPUT_PREFERENCES_KEY) || '{}')); } catch { return defaultOutputPreferences(); }
}

/** CSS for the video on the external display: fit, quarter turns and mirror. Applied by the compositor, not drawn per frame. */
export function pictureStyle(p: Pick<OutputPreferences, 'rotation' | 'mirror' | 'fit'>): string {
  const sideways = p.rotation === 90 || p.rotation === 270;
  // A sideways picture is laid out in a box with the display's width and height swapped, then turned into place.
  const size = sideways ? 'width:100vh;height:100vw;' : 'width:100vw;height:100vh;';
  const turn = `translate(-50%,-50%) rotate(${p.rotation}deg)${p.mirror ? ' scaleX(-1)' : ''}`;
  return `position:absolute;left:50%;top:50%;${size}object-fit:${p.fit};transform:${turn};`;
}

export type OutputStatus = {
  native: boolean;
  platform?: 'ios' | 'android' | 'web';
  connected: boolean;
  display?: { name: string; width: number; height: number };
  /** Modes the connected display offers (iOS). */
  modes?: DisplayMode[];
  state: 'disconnected' | 'connecting' | 'live' | 'off' | 'error';
  message?: string;
};
type NativeWindow = Window & { GhostOutputAndroid?: { postMessage: (value: string) => void }; webkit?: { messageHandlers?: { ghostOutput?: { postMessage: (value: unknown) => void } } } };
type DisplayDetail = { connected: boolean; revision?: number; display?: OutputStatus['display']; modes?: unknown };

/** Delay before the next automatic restart: 1, 2, 4, then every 8 seconds while the display stays connected. */
export const retryDelay = (attempt: number): number => Math.min(8000, 1000 * 2 ** Math.max(0, attempt));

/** One compositor feeds both displays. The secondary WebKit window contains only a video. */
export class ExternalOutput {
  private popup: Window | null = null;
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private timeout: ReturnType<typeof setTimeout> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private watchdog: ReturnType<typeof setInterval> | undefined;
  private retries = 0;
  private connected = false;
  private revision = -1;
  private display: OutputStatus['display'];
  private modes: DisplayMode[] = [];
  private state: OutputStatus['state'] = 'disconnected';
  private preferences = loadOutputPreferences();
  private generation = 0;
  private destroyed = false;
  private android = (window as NativeWindow).GhostOutputAndroid;
  private native = this.android ? { postMessage: (value: unknown) => this.android!.postMessage(JSON.stringify(value)) } : (window as NativeWindow).webkit?.messageHandlers?.ghostOutput;
  private changed = (event: Event) => {
    const detail = (event as CustomEvent<DisplayDetail>).detail;
    const changed = detail?.revision !== undefined && detail.revision !== this.revision;
    this.revision = detail?.revision ?? this.revision;
    this.display = detail?.display;
    this.modes = Array.isArray(detail?.modes) ? (detail.modes as unknown[]).flatMap((m) => { const mode = m as Partial<DisplayMode>; return Number.isInteger(mode?.width) && Number.isInteger(mode?.height) ? [{ width: mode.width!, height: mode.height! }] : []; }) : [];
    this.connected = !!detail?.connected;
    if (!this.connected) { this.retries = 0; this.close(); this.report('disconnected'); }
    else if (!this.preferences.enabled) { this.close(); this.report('off'); }
    else if (changed || !this.popup || this.popup.closed) this.start();
    else this.resume();
  };
  /** Back from the lock screen or another app: the picture comes back without a tap. */
  private visible = () => {
    if (document.visibilityState !== 'visible' || !this.connected || !this.preferences.enabled || this.destroyed) return;
    if (this.state === 'live' && this.popup && !this.popup.closed) this.resume();
    else this.start();
  };
  /** The canvas this output shows (the program the recorder records too). */
  readonly source: HTMLCanvasElement;
  constructor(canvas: HTMLCanvasElement, private onstatus: (status: OutputStatus) => void) {
    this.source = canvas;
    window.addEventListener('ghost-external-display', this.changed);
    document.addEventListener('visibilitychange', this.visible);
    window.addEventListener('pageshow', this.visible);
    this.report('disconnected');
    this.sendDisplay();
    this.native?.postMessage({ type: 'ready' });
  }
  private report(state: OutputStatus['state'], message?: string) {
    if (this.destroyed) return;
    this.state = state;
    if (state === 'live') this.retries = 0;
    this.onstatus({ native: !!this.native, platform: this.android ? 'android' : this.native ? 'ios' : 'web', connected: this.connected, display: this.display, modes: this.modes, state, message });
    this.native?.postMessage({ type: 'status', state });
  }
  /** The display's own settings (edge margin and mode) are applied by the app on iOS. */
  private sendDisplay() {
    const { fullFrame, mode } = this.preferences;
    this.native?.postMessage({ type: 'display', fullFrame, width: mode?.width ?? 0, height: mode?.height ?? 0 });
  }
  configure(preferences: OutputPreferences) {
    const before = this.preferences;
    const next = normalizeOutputPreferences(preferences);
    const restart = before.frameRate !== next.frameRate || before.enabled !== next.enabled;
    this.preferences = next;
    try { localStorage.setItem(OUTPUT_PREFERENCES_KEY, JSON.stringify(next)); } catch { /* the choice still applies until the app closes */ }
    if (before.fullFrame !== next.fullFrame || before.mode?.width !== next.mode?.width || before.mode?.height !== next.mode?.height) this.sendDisplay();
    this.applyPicture();
    if (this.connected && restart) { if (next.enabled) this.start(); else { this.close(); this.report('off'); } }
  }
  chooseWireless() { if (this.android) this.native?.postMessage({ type: 'chooseWireless' }); }
  retry() { this.retries = 0; if (this.connected && this.preferences.enabled) this.start(); else this.native?.postMessage({ type: 'ready' }); }
  private applyPicture() {
    if (this.video) this.video.style.cssText = pictureStyle(this.preferences);
  }
  /** A paused or ended picture after the app was in the background: play it again, or start over. */
  private resume() {
    const video = this.video;
    const ended = this.stream?.getVideoTracks().some((t) => t.readyState === 'ended');
    if (!video || ended || !this.popup || this.popup.closed) { this.start(); return; }
    if (video.paused) video.play().then(() => { if (this.state !== 'live') this.report('live'); }, (e) => { if (e?.name !== 'AbortError') this.start(); });
  }
  /** After a failure the output keeps trying by itself while the display is connected. */
  private scheduleRetry() {
    clearTimeout(this.retryTimer);
    if (!this.connected || !this.preferences.enabled || this.destroyed) return;
    this.retryTimer = setTimeout(() => { if (this.connected && this.preferences.enabled && this.state !== 'live') this.start(); }, retryDelay(this.retries++));
  }
  private fail(message: string) {
    this.close();
    this.report('error', this.connected && this.preferences.enabled ? `${message} Trying again…` : message);
    this.scheduleRetry();
  }
  private start() {
    this.close(); const generation = ++this.generation;
    this.report('connecting');
    try {
      if (typeof this.source.captureStream !== 'function') throw new Error('This iOS version cannot capture the live output.');
      // Native WKUIDelegate places this same-origin popup on the external scene, not the phone.
      const popup = window.open('about:blank', 'ghost-arcade-program');
      if (!popup) throw new Error('The output window could not open.');
      this.popup = popup;
      popup.document.open();
      popup.document.write('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ghost Arcade Program</title><style>html,body{margin:0;width:100%;height:100%;background:#000;overflow:hidden}video{display:block;background:#000}</style></head><body><video muted autoplay playsinline disablepictureinpicture></video></body></html>');
      popup.document.close();
      const video = popup.document.querySelector('video')!; this.video = video;
      video.muted = true; video.playsInline = true; video.disableRemotePlayback = true;
      this.applyPicture();
      // Canvas capture stays inside WebKit's media pipeline; no per-frame JS readback or native bridge transfer.
      this.stream = this.source.captureStream(this.preferences.frameRate);
      if (!this.stream.getVideoTracks().length) throw new Error('Live output capture could not start.');
      video.srcObject = this.stream;
      const ready = () => { if (generation !== this.generation) return; clearTimeout(this.timeout); this.report('live'); };
      this.timeout = setTimeout(() => { if (generation === this.generation) this.fail('The display connected but has not received a picture yet.'); }, 10000);
      if (typeof video.requestVideoFrameCallback === 'function') video.requestVideoFrameCallback(ready);
      else video.addEventListener('loadeddata', ready, { once: true });
      // WebKit aborts the first play() when the stream attaches mid-load; the frame callback or the timeout decides then.
      video.play().catch((e) => { if (generation === this.generation && e?.name !== 'AbortError') { clearTimeout(this.timeout); this.fail(`The picture could not start: ${String(e?.message ?? e).replace(/\.$/, '')}.`); } });
      // Media can be paused by the system (lock screen, a call); look every two seconds while the app is in front.
      this.watchdog = setInterval(() => { if (generation === this.generation && document.visibilityState === 'visible' && this.state === 'live') this.resume(); }, 2000);
    } catch (e) { this.fail(e instanceof Error ? e.message : 'Could not start clean output.'); }
  }
  private close() {
    this.generation++; clearTimeout(this.timeout); clearTimeout(this.retryTimer); clearInterval(this.watchdog);
    try { if (this.video) { this.video.pause(); this.video.srcObject = null; } } catch { /* already gone */ }
    this.video = null; this.stream?.getTracks().forEach((t) => t.stop()); this.stream = null;
    try { this.popup?.close(); } catch { /* already closed */ }
    this.popup = null;
  }
  destroy() {
    this.destroyed = true;
    window.removeEventListener('ghost-external-display', this.changed);
    document.removeEventListener('visibilitychange', this.visible);
    window.removeEventListener('pageshow', this.visible);
    this.close();
  }
}
