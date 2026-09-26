/**
 * PJLink against a fake projector on 127.0.0.1.
 *
 * The client is the real electron/pjlink.cjs the main process uses; the
 * projector is scripts/fake-pjlink-server.cjs. Covers the wire protocol
 * (greeting, MD5 digest on the first command only, one reply per command),
 * wrong and missing passwords, ERR1-ERR4 replies, status parsing, and the
 * projector store driven by a cue.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import net from 'node:net';
import { projectors, setPjlinkTransport, type PjlinkRequest } from './projectors';
import { CueEngine } from './cueList';

const require = createRequire(import.meta.url);
const { runSession, createPjlinkClient, md5hex, parseReply } = require('../../../electron/pjlink.cjs');
const { startFakePjlink } = require('../../../scripts/fake-pjlink-server.cjs');

type Fake = Awaited<ReturnType<typeof startFakePjlink>>;
const servers: Fake[] = [];
async function fake(opts: Record<string, unknown> = {}): Promise<Fake> {
  const s = await startFakePjlink(opts);
  servers.push(s);
  return s;
}

afterEach(async () => {
  projectors._resetForTest();
  while (servers.length) await servers.pop()!.close();
});

describe('PJLink wire protocol', () => {
  it('computes the digest the spec gives as its example', () => {
    // PJLink class 1 spec: random "498e4a67", password "JBMIAProjectorLink".
    expect(md5hex('498e4a67JBMIAProjectorLink')).toBe('5d8409bc1c3fa39749434aa3a5c38682');
  });

  it('parses replies and error codes', () => {
    expect(parseReply('%1POWR=OK')).toMatchObject({ command: 'POWR', ok: true, value: 'OK' });
    expect(parseReply('%1INPT=ERR3')).toMatchObject({ ok: false, error: 'unavailable time' });
    expect(parseReply('garbage').ok).toBe(false);
  });

  it('authenticates with MD5 on the first command only', async () => {
    const s = await fake({ password: 'secret', random: '0123abcd' });
    const r = await runSession({ host: '127.0.0.1', port: s.port, password: 'secret', commands: ['POWR 1', 'AVMT 31', 'POWR ?'] });
    expect(r.ok).toBe(true);
    expect(r.authenticated).toBe(true);
    expect(r.responses.map((x: { value: string }) => x.value)).toEqual(['OK', 'OK', '1']);
    expect(s.received.map((x: { line: string; authenticated: boolean }) => [x.line, x.authenticated])).toEqual([
      ['%1POWR 1', true],
      ['%1AVMT 31', true],
      ['%1POWR ?', true],
    ]);
  });

  it('works without authentication when the projector has none', async () => {
    const s = await fake();
    const r = await runSession({ host: '127.0.0.1', port: s.port, commands: ['NAME ?'] });
    expect(r).toMatchObject({ ok: true, authenticated: false });
    expect(r.responses[0].value).toBe('Fake Projector');
  });

  it('reports a wrong password and never gets a command through', async () => {
    const s = await fake({ password: 'right' });
    const r = await runSession({ host: '127.0.0.1', port: s.port, password: 'wrong', commands: ['POWR 1'] });
    expect(r.ok).toBe(false);
    expect(r.sessionError).toBe('authentication failed');
    expect(s.state.power).toBe(0);
    expect(s.received[0]).toMatchObject({ rejected: true });
  });

  it('refuses to connect without a password when one is required', async () => {
    const s = await fake({ password: 'right' });
    const r = await runSession({ host: '127.0.0.1', port: s.port, commands: ['POWR 1'] });
    expect(r.sessionError).toBe('authentication required');
    expect(s.received).toHaveLength(0);
  });

  it('surfaces ERR2 and ERR3 replies without failing the session', async () => {
    const s = await fake();
    const r = await runSession({ host: '127.0.0.1', port: s.port, commands: ['INPT 31', 'POWR 7', 'XXXX ?'] });
    expect(r.ok).toBe(false);
    expect(r.sessionError).toBeNull();
    expect(r.responses.map((x: { value: string }) => x.value)).toEqual(['ERR3', 'ERR2', 'ERR1']);
    expect(r.error).toBe('INPT: unavailable time');
  });

  it('rejects commands that could inject a line break', async () => {
    const r = await runSession({ host: '127.0.0.1', port: 1, commands: ['POWR 1\r%1POWR 0'] });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/invalid command/);
  });

  it('reports a refused connection and a silent peer', async () => {
    const closed = await fake();
    const port = closed.port;
    await closed.close();
    servers.pop();
    const refused = await runSession({ host: '127.0.0.1', port, commands: ['POWR ?'], timeoutMs: 2000 });
    expect(refused.ok).toBe(false);
    expect(refused.sessionError).toBe('ECONNREFUSED');

    const silent = net.createServer(() => { /* never greets */ });
    await new Promise<void>((r) => silent.listen(0, '127.0.0.1', () => r()));
    const t = await runSession({ host: '127.0.0.1', port: (silent.address() as net.AddressInfo).port, commands: ['POWR ?'], timeoutMs: 300 });
    expect(t.sessionError).toBe('timed out');
    await new Promise((r) => silent.close(r));
  });

  it('parses a status poll', async () => {
    const s = await fake({ password: 'pw' });
    s.state.power = 1;
    s.state.avmt = '31';
    s.state.errors = '010002';
    const client = createPjlinkClient();
    const r = await client.run({ host: '127.0.0.1', port: s.port, password: 'pw', action: 'status' });
    expect(r.ok).toBe(true);
    expect(r.status).toEqual({
      power: 'on',
      shutter: 'closed',
      input: '31',
      errors: { fan: 'ok', lamp: 'warning', temperature: 'ok', cover: 'ok', filter: 'ok', other: 'error' },
      lampHours: 1234,
      name: 'Fake Projector',
    });
  });

  it('serialises concurrent requests to one projector', async () => {
    const s = await fake({ password: 'pw' });
    const client = createPjlinkClient();
    const results = await Promise.all([
      client.run({ host: '127.0.0.1', port: s.port, password: 'pw', action: 'power-on' }),
      client.run({ host: '127.0.0.1', port: s.port, password: 'pw', action: 'shutter-close' }),
      client.run({ host: '127.0.0.1', port: s.port, password: 'pw', action: 'input', input: '11' }),
    ]);
    expect(results.map((r: { ok: boolean }) => r.ok)).toEqual([true, true, true]);
    expect(s.received.map((x: { line: string }) => x.line)).toEqual(['%1POWR 1', '%1AVMT 31', '%1INPT 11']);
  });
});

describe('projector store driven by a cue', () => {
  it('a cue sends authenticated POWR and AVMT to every enabled projector', async () => {
    const a = await fake({ password: 'alpha' });
    const b = await fake({ password: 'beta' });
    const off = await fake();
    const client = createPjlinkClient();
    setPjlinkTransport((req: PjlinkRequest) => client.run(req));
    projectors.add({ name: 'Left', host: '127.0.0.1', port: a.port, password: 'alpha' });
    projectors.add({ name: 'Right', host: '127.0.0.1', port: b.port, password: 'beta' });
    projectors.add({ name: 'Spare', host: '127.0.0.1', port: off.port, enabled: false });

    const engine = new CueEngine();
    const pending: Promise<unknown>[] = [];
    engine.setExecutor({
      recallPreset() {}, recallSnapshot() {}, triggerClip() {}, triggerColumn() {}, stopAllClips() {},
      setBlackout() {}, readValue: () => null, writeValue() {}, timeline() {}, bpm: () => 120,
      projector: (id, command, input) => {
        const p = projectors.command(id, command, input);
        pending.push(p);
        return p;
      },
    });
    const cue = engine.addCue({ name: 'Doors' });
    engine.addAction(cue, 'projector');
    const shutter = engine.addAction(cue, 'projector');
    engine.updateAction(cue, shutter, { command: 'shutter-close' });
    engine.go();
    await Promise.all(pending);

    for (const s of [a, b]) {
      expect(s.received.map((x: { line: string; authenticated: boolean }) => [x.line, x.authenticated])).toEqual([
        ['%1POWR 1', true],
        ['%1AVMT 31', true],
      ]);
    }
    expect(off.received).toHaveLength(0);
    const status = (await import('svelte/store')).get(projectors).status;
    expect(Object.values(status).map((st) => st.lastCommand?.ok)).toEqual([true, true]);
  });

  it('a poll marks an unreachable projector offline and a live one with its state', async () => {
    const live = await fake({ password: 'x' });
    live.state.power = 1;
    const client = createPjlinkClient();
    setPjlinkTransport((req: PjlinkRequest) => client.run({ ...req, timeoutMs: 500 }));
    const up = projectors.add({ host: '127.0.0.1', port: live.port, password: 'x' });
    const down = projectors.add({ host: '127.0.0.1', port: 1 });
    await projectors.poll();
    const { get } = await import('svelte/store');
    const st = get(projectors).status;
    expect(st[up]).toMatchObject({ online: true, power: 'on', shutter: 'open', reportedName: 'Fake Projector' });
    expect(st[down]).toMatchObject({ online: false });
  });

  it('round-trips projectors through the project payload', () => {
    projectors.add({ name: 'P1', host: '10.0.0.5', password: 'pw' });
    projectors.setPollSeconds(12);
    const saved = JSON.parse(JSON.stringify(projectors.serialize()));
    projectors._resetForTest();
    projectors.hydrate(saved);
    expect(projectors.serialize()).toEqual(saved);
    expect(saved.projectors[0]).toMatchObject({ name: 'P1', host: '10.0.0.5', port: 4352, password: 'pw', enabled: true });
  });
});
