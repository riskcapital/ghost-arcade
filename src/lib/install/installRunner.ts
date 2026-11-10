/**
 * Install mode: switches the installation on and off on its schedule.
 *
 * Edge-free, like the show scheduler: every tick asks whether the
 * installation should be on now and compares that with what it last did.
 * A machine that boots, wakes or restarts in the middle of an on period
 * switches on at once; one that comes up during an off period makes sure
 * everything is off (projectors, outputs black, LEDs black).
 *
 *   off -> on:  outputs open, projectors power on (if the schedule controls
 *               them), wait for the warm-up unless they already report on,
 *               then shutter open, blackout off, LEDs follow, show starts.
 *   on -> off:  show stops, blackout on, LEDs black, shutter closed,
 *               projectors off.
 */

import { installScheduleState, type InstallSchedule } from './installSchedule';

export type InstallRunState = 'starting' | 'off' | 'warming' | 'on';

export interface InstallRunnerHooks {
  openOutputs(): void | Promise<void>;
  projector(command: 'power-on' | 'power-off' | 'shutter-open' | 'shutter-close'): void | Promise<unknown>;
  /** True when every configured projector already reports power on. */
  projectorsAreOn(): boolean;
  setBlackout(on: boolean): void;
  setLedsBlack(on: boolean): void;
  /** Start the show for an on period that began at `periodStart` (ms). */
  startShow(periodStart: number): void | Promise<void>;
  stopShow(): void;
  /** Called on every tick while on: restart a show that stopped by itself. */
  keepShowRunning?(periodStart: number): void;
  log(message: string): void;
}

export class InstallRunner {
  private state: InstallRunState = 'starting';
  private warmUntil = 0;
  private periodStart = 0;
  private readonly sessionStart: number;

  constructor(
    private readonly getSchedule: () => InstallSchedule,
    private readonly hooks: InstallRunnerHooks,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.sessionStart = now();
  }

  get current(): InstallRunState {
    return this.state;
  }

  /** When the current on period began (ms), or 0 while off. */
  get onSince(): number {
    return this.state === 'on' || this.state === 'warming' ? this.periodStart : 0;
  }

  private run(label: string, fn: () => unknown): void {
    try {
      const r = fn();
      if (r && typeof (r as Promise<unknown>).catch === 'function') {
        (r as Promise<unknown>).catch((err) => this.hooks.log(`${label} failed: ${err instanceof Error ? err.message : String(err)}`));
      }
    } catch (err) {
      this.hooks.log(`${label} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private begin(): void {
    const s = this.getSchedule();
    if (s.enabled && s.shutter) this.run('shutter open', () => this.hooks.projector('shutter-open'));
    this.run('blackout off', () => this.hooks.setBlackout(false));
    this.run('LEDs', () => this.hooks.setLedsBlack(false));
    this.state = 'on';
    this.hooks.log('show starting');
    this.run('show start', () => this.hooks.startShow(this.periodStart));
  }

  private switchOff(reason: string): void {
    const s = this.getSchedule();
    const wasStarting = this.state === 'starting';
    this.state = 'off';
    this.periodStart = 0;
    this.hooks.log(wasStarting ? `off period (${reason}): making sure everything is off` : `switching off (${reason})`);
    this.run('show stop', () => this.hooks.stopShow());
    this.run('blackout on', () => this.hooks.setBlackout(true));
    this.run('LEDs black', () => this.hooks.setLedsBlack(true));
    if (s.shutter) this.run('shutter close', () => this.hooks.projector('shutter-close'));
    if (s.projectorPower) this.run('projectors off', () => this.hooks.projector('power-off'));
  }

  tick(): InstallRunState {
    const schedule = this.getSchedule();
    const now = this.now();
    const st = installScheduleState(schedule, now);
    if (!st.on) {
      if (this.state !== 'off') this.switchOff('schedule');
      return this.state;
    }
    if (this.state === 'starting' || this.state === 'off') {
      // Without a schedule the period is this session; a later period
      // begins at its scheduled on time even if the machine came up late.
      this.periodStart = st.window ? st.window.start : this.sessionStart;
      this.hooks.log(st.window ? 'switching on (schedule)' : 'switching on');
      this.run('outputs', () => this.hooks.openOutputs());
      if (schedule.enabled && schedule.projectorPower) {
        const warm = this.hooks.projectorsAreOn();
        this.run('projectors on', () => this.hooks.projector('power-on'));
        if (!warm && schedule.warmupSeconds > 0) {
          this.state = 'warming';
          this.warmUntil = now + schedule.warmupSeconds * 1000;
          this.hooks.log(`projectors warming up for ${schedule.warmupSeconds} s`);
          return this.state;
        }
      }
      this.begin();
      return this.state;
    }
    if (this.state === 'warming') {
      if (now >= this.warmUntil) this.begin();
      return this.state;
    }
    // On: a schedule edit can move the period's start (it is still the same
    // evening); keep the show's anchor where it was.
    this.run('keep running', () => this.hooks.keepShowRunning?.(this.periodStart));
    return this.state;
  }
}
