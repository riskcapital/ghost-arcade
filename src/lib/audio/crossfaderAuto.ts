/**
 * Auto on the VJ A/B crossfader: a small playhead of its own (the fader is
 * not a clip or layer param with an Auto beside it).
 *
 * The playhead lives here, not in the Auto settings: the settings object
 * the panel holds only changes when someone edits it, so nothing that
 * watches it is woken every frame. Each frame's value goes to the fader's
 * live position (vjClipLauncher.setCrossfaderValue), which does not publish
 * the launcher.
 */
import type { AutoConfig } from '../types';

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

/** The fader value for an Auto at a playhead. */
export function crossfaderAutoValue(auto: AutoConfig, phase: number): number {
  const at = Number.isFinite(phase) ? phase : 0;
  const shaped = auto.mode === 'pingpong' ? (at < 0.5 ? at * 2 : 2 - at * 2) : at;
  const min = clamp01(auto.min);
  const max = clamp01(auto.max);
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return clamp01(lo + shaped * (hi - lo));
}

export interface CrossfaderAutoHost {
  /** Where each frame's value goes. */
  setValue: (value: number) => void;
  /** The crossfader is on (Auto only moves it then). */
  enabled: () => boolean;
  requestFrame?: (cb: (now: number) => void) => number;
  cancelFrame?: (id: number) => void;
}

export class CrossfaderAutoPlayer {
  private config: AutoConfig | undefined;
  private phase = 0;
  private raf: number | null = null;
  private lastTime = 0;
  private readonly requestFrame: (cb: (now: number) => void) => number;
  private readonly cancelFrame: (id: number) => void;

  constructor(private readonly host: CrossfaderAutoHost) {
    this.requestFrame = host.requestFrame ?? ((cb) => requestAnimationFrame(cb));
    this.cancelFrame = host.cancelFrame ?? ((id) => cancelAnimationFrame(id));
  }

  /**
   * The Auto settings (undefined: no Auto). A new Auto starts at its saved
   * phase; an edit of the one playing keeps the playhead where it is.
   */
  setConfig(config: AutoConfig | undefined): void {
    if (!config) {
      this.config = undefined;
      this.stop();
      return;
    }
    if (!this.config) this.phase = Number.isFinite(config.phase) ? config.phase : 0;
    this.config = config;
    if (config.playing) this.start();
    else this.stop();
  }

  /** The fader value now, for the frame an Auto is switched on. */
  value(): number | undefined {
    return this.config ? crossfaderAutoValue(this.config, this.phase) : undefined;
  }

  playhead(): number {
    return this.phase;
  }

  start(): void {
    if (this.raf !== null || !this.config) return;
    this.lastTime = 0;
    this.raf = this.requestFrame(this.tick);
  }

  stop(): void {
    if (this.raf !== null) this.cancelFrame(this.raf);
    this.raf = null;
    this.lastTime = 0;
  }

  private tick = (now: number): void => {
    const auto = this.config;
    if (!auto) {
      this.raf = null;
      this.lastTime = 0;
      return;
    }
    this.raf = this.requestFrame(this.tick);
    const dt = this.lastTime === 0 ? 0 : (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (!this.host.enabled() || !auto.playing || dt <= 0 || dt > 0.1) return;
    const speedHz = Number.isFinite(auto.speedHz) ? auto.speedHz : 0.15;
    const next = (this.phase + speedHz * dt) % 1;
    this.phase = next < 0 ? next + 1 : next;
    this.host.setValue(crossfaderAutoValue(auto, this.phase));
  };
}
