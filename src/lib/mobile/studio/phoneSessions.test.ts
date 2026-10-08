import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defaultInteractive } from './interactive';
import {
  PhoneSessions,
  PHONE_INPUT_RELEASE_MS,
  PHONE_SESSION_GRACE_MS,
  phoneSenderId,
  sanitizePhoneInputs,
  type PhoneSessionHost,
} from './phoneSessions';

const touch = [{ id: 't', point: { x: 0.5, y: 0.5 }, strength: 1, mode: 'attract' as const }];
const state = (inputs = touch) => ({ scene: defaultInteractive(), inputs, paused: false });

function setup() {
  const log: string[] = [];
  const host: PhoneSessionHost = {
    apply: (phone, s, starting) => log.push(`apply ${phone} inputs=${s.inputs.length}${starting ? ' start' : ''}`),
    releaseInputs: (phone) => log.push(`release ${phone}`),
    stop: (phone, reason) => log.push(`stop ${phone} ${reason}`),
  };
  return { log, sessions: new PhoneSessions(host, () => Date.now()) };
}

describe('paired phone sessions', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('survives a Wi-Fi blip or a locked phone far beyond the old 3 s cut-off', () => {
    const { log, sessions } = setup();
    sessions.receive('a', state([]), true);
    vi.advanceTimersByTime(PHONE_SESSION_GRACE_MS - 1);
    expect(log).toEqual(['apply a inputs=0 start']);
    expect(sessions.isActive('a')).toBe(true);
  });

  it('releases a held touch after two missed heartbeats but keeps the scene', () => {
    const { log, sessions } = setup();
    sessions.receive('a', state(), true);
    vi.advanceTimersByTime(PHONE_INPUT_RELEASE_MS + 1);
    expect(log).toEqual(['apply a inputs=1 start', 'release a']);
    expect(sessions.isActive('a')).toBe(true);
    // The phone wakes up still touching: the touch is applied again.
    sessions.receive('a', state(), true);
    expect(log.at(-1)).toBe('apply a inputs=1');
  });

  it('expires only the silent phone and resumes it cleanly when it returns', () => {
    const { log, sessions } = setup();
    sessions.receive('a', state([]), true);
    sessions.receive('b', state([]), true);
    for (let t = 0; t < PHONE_SESSION_GRACE_MS + 2000; t += 1000) {
      vi.advanceTimersByTime(1000);
      sessions.receive('b', state([]), true); // b keeps its heartbeat
    }
    expect(log.filter((l) => l.startsWith('stop'))).toEqual(['stop a expired']);
    expect(sessions.isActive('b')).toBe(true);
    sessions.receive('a', state([]), true);
    expect(log.at(-1)).toBe('apply a inputs=0 start');
  });

  it('one phone stopping never stops another', () => {
    const { log, sessions } = setup();
    sessions.receive('a', state([]), true);
    sessions.receive('b', state([]), true);
    sessions.receive('a', state([]), false);
    expect(log.at(-1)).toBe('stop a stopped');
    expect(sessions.isActive('b')).toBe(true);
    // A stop from a phone that was never live is ignored.
    sessions.receive('c', state([]), false);
    expect(log.some((l) => l.includes(' c '))).toBe(false);
  });

  it('does not rewrite the project for an unchanged heartbeat', () => {
    const { log, sessions } = setup();
    sessions.receive('a', state([]), true);
    sessions.receive('a', state([]), true);
    sessions.receive('a', state([]), true);
    expect(log).toHaveLength(1);
  });

  it('puts the scene back on the next heartbeat when its layer was deleted', () => {
    const { log, sessions } = setup();
    let present = true;
    const host = (sessions as unknown as { host: PhoneSessionHost }).host;
    host.hasTarget = () => present;
    sessions.receive('a', state([]), true);
    sessions.receive('a', state([]), true);
    expect(log).toHaveLength(1);
    present = false; // the operator deleted the phone's layer, or opened another project
    sessions.receive('a', state([]), true);
    expect(log).toEqual(['apply a inputs=0 start', 'apply a inputs=0']);
  });

  it('keeps the scene alive on an unusable message and rate-limits the notice', () => {
    const { log, sessions } = setup();
    sessions.receive('a', state([]), true);
    vi.advanceTimersByTime(PHONE_SESSION_GRACE_MS - 1000);
    sessions.keepAlive('a');
    vi.advanceTimersByTime(PHONE_SESSION_GRACE_MS - 1000);
    expect(log.filter((l) => l.startsWith('stop'))).toEqual([]);
    expect(sessions.shouldNotifyRejection('a')).toBe(true);
    expect(sessions.shouldNotifyRejection('a')).toBe(false);
    vi.advanceTimersByTime(1001);
    expect(sessions.shouldNotifyRejection('a')).toBe(true);
  });

  it('bounds sender ids and touch input', () => {
    expect(phoneSenderId('10.0.0.7:abc')).toBe('10.0.0.7:abc');
    expect(phoneSenderId('x'.repeat(200))).toBe('phone');
    expect(phoneSenderId({})).toBe('phone');
    const inputs = sanitizePhoneInputs([
      null,
      { point: { x: 2, y: -1 }, strength: 9, mode: 'vortex', junk: 'x'.repeat(1000) },
      { point: { x: Number.NaN, y: 0 }, strength: 1 },
      ...Array.from({ length: 20 }, () => ({ point: { x: 0.1, y: 0.1 }, strength: 0.5 })),
    ]);
    expect(inputs.length).toBeLessThanOrEqual(8);
    expect(inputs[0]).toEqual({ id: 'touch-0', point: { x: 1, y: 0 }, strength: 1, mode: 'vortex' });
    expect(JSON.stringify(inputs)).not.toContain('junk');
    expect(sanitizePhoneInputs('nope')).toEqual([]);
  });
});
