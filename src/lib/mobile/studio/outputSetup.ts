// The "Connect a projector" setup: when the main screen says nothing is connected, and which step
// of the setup is showing. Kept apart from the components so it can be tested without a display.
import type { OutputStatus } from './externalOutput';

/** The banner shows in the installed app whenever no external display is connected. */
export function showNoDisplayBanner(status: Pick<OutputStatus, 'native' | 'connected'>): boolean {
  return status.native && !status.connected;
}

export type SetupStep = 'connect' | 'test' | 'done';

/**
 * The next step of the setup. A display that connects moves "connect" on to the test pattern by
 * itself (a cable needs no tap); one that goes away sends any later step back to "connect".
 * `confirmed` is the person saying the test pattern is on the wall.
 */
export function nextSetupStep(step: SetupStep, connected: boolean, confirmed = false): SetupStep {
  if (!connected) return 'connect';
  if (step === 'connect') return 'test';
  if (step === 'test' && confirmed) return 'done';
  return step;
}

/** Why the projector might be dark while the test pattern is on, in the order worth checking. */
export function darkOutputReasons(s: { enabled: boolean; blackout: boolean; master: number; state: OutputStatus['state'] }): Array<'off' | 'blackout' | 'master' | 'starting'> {
  const reasons: Array<'off' | 'blackout' | 'master' | 'starting'> = [];
  if (!s.enabled) reasons.push('off');
  if (s.blackout) reasons.push('blackout');
  if (s.master <= 0.05) reasons.push('master');
  if (s.enabled && s.state !== 'live') reasons.push('starting');
  return reasons;
}

/** "1920 × 1080", or "" when the size is unknown. */
export function displaySize(display: OutputStatus['display']): string {
  return display && display.width > 0 && display.height > 0 ? `${display.width} × ${display.height}` : '';
}
