/**
 * The add-on licence in the main process (electron/addons/entitlement.cjs):
 * the signature, the state of each add-on over time, and the store against
 * a stand-in licence server speaking the website's JSON.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const ent = require('../../../electron/addons/entitlement.cjs');
const { trustedLicenceKeys } = require('../../../electron/addons/keys.cjs');

const DAY = 86_400_000;
const T0 = Date.parse('2026-11-20T12:00:00.000Z');

function keyPair(): { privateKey: KeyObject; publicHex: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const der = publicKey.export({ format: 'der', type: 'spki' }) as Buffer;
  return { privateKey, publicHex: der.subarray(der.length - 32).toString('hex') };
}
const pair = keyPair();
const KEYS = { 'lic-test': pair.publicHex };

type Product = { id: string; kind: 'perpetual' | 'trial'; expires_at?: string };
function envelope(machineId: string, products: Product[], issuedAt = T0, privateKey = pair.privateKey, kid = 'lic-test') {
  const payload = JSON.stringify({
    v: 2, kid, licence_id: 'lic-1', user_id: 'user-1', email: 'buyer@example.com', machine_id: machineId, products,
    issued_at: new Date(issuedAt).toISOString(),
    refresh_after: new Date(issuedAt + 7 * DAY).toISOString(),
    valid_until: new Date(issuedAt + 30 * DAY).toISOString(),
  });
  return { format: 'ghost-arcade-entitlement', v: 2, kid, payload, signature: sign(null, Buffer.from(payload, 'utf8'), privateKey).toString('hex') };
}
const AUDIO_LAB: Product = { id: 'addon.audio-lab', kind: 'perpetual' };
const trialOf = (id: string, endsAt: number): Product => ({ id, kind: 'trial', expires_at: new Date(endsAt).toISOString() });

describe('signature', () => {
  it('accepts a payload signed with a trusted key, exactly as received', () => {
    const r = ent.verifyEntitlement(envelope('m', [AUDIO_LAB]), KEYS);
    expect(r.ok).toBe(true);
    expect(r.payload.products).toEqual([AUDIO_LAB]);
  });

  it('refuses a changed payload, another key, an unknown kid and a broken envelope', () => {
    const good = envelope('m', [AUDIO_LAB]);
    expect(ent.verifyEntitlement({ ...good, payload: good.payload.replace('perpetual', 'perpetual ') }, KEYS)).toEqual({ ok: false, reason: 'signature' });
    expect(ent.verifyEntitlement(envelope('m', [AUDIO_LAB], T0, keyPair().privateKey), KEYS)).toEqual({ ok: false, reason: 'signature' });
    expect(ent.verifyEntitlement(envelope('m', [AUDIO_LAB], T0, pair.privateKey, 'lic-other'), KEYS)).toEqual({ ok: false, reason: 'unknown_key' });
    expect(ent.verifyEntitlement({ ...good, format: 'x' }, KEYS).ok).toBe(false);
    expect(ent.verifyEntitlement({ ...good, signature: 'zz' }, KEYS).ok).toBe(false);
    expect(ent.verifyEntitlement(null, KEYS).ok).toBe(false);
  });

  it('trusts the development key only in an unpackaged app', () => {
    expect(Object.keys(trustedLicenceKeys({ isPackaged: false }))).toContain('lic-dev');
    expect(Object.keys(trustedLicenceKeys({ isPackaged: true }))).not.toContain('lic-dev');
  });
});

describe('state over time', () => {
  const payloadOf = (products: Product[], issuedAt = T0) => JSON.parse(envelope('m', products, issuedAt).payload);
  const at = (products: Product[], now: number, extra: Record<string, unknown> = {}) =>
    ent.addonState({ payload: payloadOf(products), productId: 'addon.audio-lab', now, ...extra });

  it('is locked with no licence, or one without this add-on', () => {
    expect(ent.addonState({ payload: null, productId: 'addon.audio-lab', now: T0 })).toEqual({ kind: 'locked' });
    expect(at([{ id: 'addon.analog-synth', kind: 'perpetual' }], T0)).toEqual({ kind: 'locked' });
  });

  it('is licensed, then in its offline grace from day 23, then expired after 30 days', () => {
    expect(at([AUDIO_LAB], T0)).toEqual({ kind: 'licensed' });
    expect(at([AUDIO_LAB], T0 + 22.9 * DAY)).toEqual({ kind: 'licensed' });
    expect(at([AUDIO_LAB], T0 + 23 * DAY)).toEqual({ kind: 'offline-grace', daysLeft: 7 });
    expect(at([AUDIO_LAB], T0 + 29.5 * DAY)).toEqual({ kind: 'offline-grace', daysLeft: 1 });
    expect(at([AUDIO_LAB], T0 + 30 * DAY)).toEqual({ kind: 'expired', why: 'offline' });
  });

  it('runs 14 days longer with the emergency extension', () => {
    const until = T0 + 31 * DAY + 14 * DAY;
    expect(at([AUDIO_LAB], T0 + 31 * DAY, { emergencyUntil: until })).toEqual({ kind: 'offline-grace', daysLeft: 14 });
    expect(at([AUDIO_LAB], until, { emergencyUntil: until })).toEqual({ kind: 'expired', why: 'offline' });
  });

  it('counts a trial down and ends it', () => {
    const ends = T0 + 3 * DAY;
    expect(at([trialOf('addon.audio-lab', ends)], T0)).toEqual({ kind: 'trial', daysLeft: 3, endsAt: new Date(ends).toISOString() });
    expect(at([trialOf('addon.audio-lab', ends)], T0 + 2.5 * DAY)).toMatchObject({ kind: 'trial', daysLeft: 1 });
    expect(at([trialOf('addon.audio-lab', ends)], ends)).toEqual({ kind: 'expired', why: 'trial-ended' });
  });

  it('remembers a trial the website no longer lists as ended, not as never tried', () => {
    expect(at([], T0 + 4 * DAY, { trialEndsAt: T0 + 3 * DAY })).toEqual({ kind: 'expired', why: 'trial-ended' });
  });

  it('counts only trial, licensed and offline grace as usable', () => {
    expect(['locked', 'trial', 'licensed', 'expired', 'offline-grace'].map((kind) => ent.stateIsUsable({ kind }))).toEqual([false, true, true, false, true]);
  });
});

// ─── The store, against a stand-in licence server ─────────────────────────

let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

interface Server { calls: Array<{ path: string; body: any }>; reply: (path: string, body: any) => { status: number; json: unknown } | 'offline' }

function setup(overrides: Partial<Server> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ga-licence-'));
  dirs.push(dir);
  const clock = { now: T0 };
  const server: Server = {
    calls: [],
    reply: (path, body) => {
      if (path === '/api/license/activate' || path === '/api/license/validate') {
        if (body.licenseKey !== 'GA-AAAA-BBBB-CCCC-DDDD') return { status: path.endsWith('activate') ? 404 : 200, json: path.endsWith('activate') ? { code: 'invalid_key' } : { valid: false, code: 'invalid_key' } };
        const e = envelope(body.machineId, [AUDIO_LAB, trialOf('addon.analog-synth', clock.now + 3 * DAY)], clock.now);
        return { status: 200, json: path.endsWith('activate') ? { ok: true, entitlement: e } : { valid: true, entitlement: e } };
      }
      if (path === '/api/license/deactivate') return { status: 200, json: { success: true } };
      return { status: 404, json: {} };
    },
    ...overrides,
  };
  const fetchImpl = async (url: string, init: { body: string }) => {
    const path = new URL(url).pathname;
    const body = JSON.parse(init.body);
    server.calls.push({ path, body });
    const r = server.reply(path, body);
    if (r === 'offline') throw new TypeError('fetch failed');
    return { status: r.status, json: async () => r.json };
  };
  const make = () => ent.createAddonEntitlements({
    userDataDir: dir, isPackaged: false, env: { GA_LICENCE_API: 'http://localhost:9999' },
    fetchImpl, now: () => clock.now, osMachineId: () => 'os-id', hostname: () => 'Stage Mac', keys: KEYS, log: { warn: () => {} },
  });
  return { dir, clock, server, store: make(), make };
}
const product = (s: any, id: string) => s.products[id];

describe('the licence on this computer', () => {
  it('starts locked, activates with a key, and stores the signed entitlement', async () => {
    const { store, dir, server } = setup();
    expect(product(store.status(), 'addon.audio-lab')).toEqual({ state: { kind: 'locked' }, usable: false });
    const r = await store.activate(' ga-aaaa-bbbb-cccc-dddd ');
    expect(r.ok).toBe(true);
    expect(server.calls[0]).toMatchObject({ path: '/api/license/activate', body: { licenseKey: 'GA-AAAA-BBBB-CCCC-DDDD', hostname: 'Stage Mac', v: 2 } });
    expect(server.calls[0].body.machineId).toBe(store.machineId());
    expect(product(r.status, 'addon.audio-lab')).toEqual({ state: { kind: 'licensed' }, usable: true });
    expect(product(r.status, 'addon.analog-synth').state).toMatchObject({ kind: 'trial', daysLeft: 3 });
    expect(r.status.licence).toMatchObject({ key: 'GA-••••-••••-••••-DDDD', email: 'buyer@example.com' });
    expect(JSON.parse(readFileSync(join(dir, 'licence', 'entitlement.json'), 'utf8')).entitlement.format).toBe('ghost-arcade-entitlement');
    // The full key never goes to the renderer.
    expect(JSON.stringify(r.status)).not.toContain('AAAA');
  });

  it('keeps the same machine id across runs, from the OS id and a random install id', () => {
    const { store, make } = setup();
    expect(store.machineId()).toMatch(/^[0-9a-f]{64}$/);
    expect(make().machineId()).toBe(store.machineId());
    expect(setup().store.machineId()).not.toBe(store.machineId());
  });

  it('says why a key is refused, and lists the seats when the licence is full', async () => {
    const { store } = setup({
      reply: (path) => (path === '/api/license/activate'
        ? { status: 409, json: { code: 'machine_limit', maxMachines: 2, machines: [{ id: '0b9f6d0e-0000-4000-8000-000000000001', hostname: 'Laptop', activated_at: 'a', last_seen_at: 'b' }] } }
        : { status: 200, json: { success: true } }),
    });
    expect(await store.activate('nope')).toEqual({ ok: false, code: 'bad_key' });
    const full = await store.activate('GA-AAAA-BBBB-CCCC-DDDD');
    expect(full).toMatchObject({ ok: false, code: 'machine_limit', maxMachines: 2, machines: [{ hostname: 'Laptop' }] });
    expect(await setup({ reply: () => 'offline' }).store.activate('GA-AAAA-BBBB-CCCC-DDDD')).toEqual({ ok: false, code: 'network' });
    expect(await setup().store.activate('GA-ZZZZ-ZZZZ-ZZZZ-ZZZZ')).toEqual({ ok: false, code: 'invalid_key' });
  });

  it('refuses an entitlement signed for another computer or with an untrusted key', async () => {
    const other = setup({ reply: () => ({ status: 200, json: { ok: true, entitlement: envelope('someone-else', [AUDIO_LAB]) } }) });
    expect(await other.store.activate('GA-AAAA-BBBB-CCCC-DDDD')).toEqual({ ok: false, code: 'bad_reply' });
    const forged = setup({ reply: (_p, body) => ({ status: 200, json: { ok: true, entitlement: envelope(body.machineId, [AUDIO_LAB], T0, keyPair().privateKey) } }) });
    expect(await forged.store.activate('GA-AAAA-BBBB-CCCC-DDDD')).toEqual({ ok: false, code: 'bad_reply' });
    expect(product(forged.store.status(), 'addon.audio-lab').usable).toBe(false);
  });

  it('reads a copied entitlement on another computer as locked', async () => {
    const a = setup();
    await a.store.activate('GA-AAAA-BBBB-CCCC-DDDD');
    const copy = ent.createAddonEntitlements({ userDataDir: a.dir, isPackaged: false, now: () => T0, osMachineId: () => 'different-os', keys: KEYS, log: { warn: () => {} } });
    const s = copy.status();
    expect(s.problem).toBe('other-computer');
    expect(product(s, 'addon.audio-lab').usable).toBe(false);
  });

  it('keeps an add-on usable until quit after it locks mid-run, but not in the next run', async () => {
    const { store, clock, make } = setup();
    await store.activate('GA-AAAA-BBBB-CCCC-DDDD');
    expect(product(store.status(), 'addon.analog-synth').usable).toBe(true);
    clock.now += 4 * DAY; // the synth trial ends
    expect(product(store.status(), 'addon.analog-synth')).toEqual({ state: { kind: 'expired', why: 'trial-ended' }, usable: true });
    expect(product(make().status(), 'addon.analog-synth')).toEqual({ state: { kind: 'expired', why: 'trial-ended' }, usable: false });
  });

  it('refreshes quietly once a week, at a check, and not again for hours when offline', async () => {
    const { store, clock, server } = setup();
    await store.activate('GA-AAAA-BBBB-CCCC-DDDD');
    server.calls.length = 0;
    clock.now += 6 * DAY;
    store.checkpoint();
    expect(server.calls).toHaveLength(0);
    clock.now += 2 * DAY;
    server.reply = () => 'offline';
    store.checkpoint();
    await Promise.resolve();
    expect(server.calls.map((c) => c.path)).toEqual(['/api/license/validate']);
    await new Promise((r) => setTimeout(r, 0));
    store.checkpoint();
    expect(server.calls).toHaveLength(1);
    clock.now += 7 * 3_600_000;
    store.checkpoint();
    expect(server.calls).toHaveLength(2);
    // Offline the whole time: still licensed (day 8).
    expect(product(store.status(), 'addon.audio-lab').state).toEqual({ kind: 'licensed' });
  });

  it('drops the licence when the website says the key is gone, keeps it when it cannot be reached', async () => {
    const a = setup();
    await a.store.activate('GA-AAAA-BBBB-CCCC-DDDD');
    a.server.reply = () => 'offline';
    expect(await a.store.refresh()).toMatchObject({ ok: false, code: 'network' });
    expect(a.make().status().licence?.key).toBeTruthy();
    a.server.reply = () => ({ status: 200, json: { valid: false, code: 'invalid_key' } });
    expect(await a.store.refresh()).toMatchObject({ ok: false, code: 'invalid_key' });
    const next = a.make().status();
    expect(next.licence).toBeNull();
    expect(product(next, 'addon.audio-lab').usable).toBe(false);
  });

  it('keeps the key but not the entitlement after this computer is deactivated on the website', async () => {
    const a = setup();
    await a.store.activate('GA-AAAA-BBBB-CCCC-DDDD');
    a.server.reply = () => ({ status: 200, json: { valid: false, code: 'machine_not_activated' } });
    await a.store.refresh();
    const next = a.make().status();
    expect(next.licence).toMatchObject({ key: 'GA-••••-••••-••••-DDDD', checkedAt: null });
    expect(product(next, 'addon.audio-lab').state).toEqual({ kind: 'locked' });
  });

  it('deactivates this computer, and the add-ons keep working until quit', async () => {
    const { store, server, make } = setup();
    await store.activate('GA-AAAA-BBBB-CCCC-DDDD');
    const r = await store.deactivate();
    expect(server.calls.at(-1)).toMatchObject({ path: '/api/license/deactivate', body: { licenseKey: 'GA-AAAA-BBBB-CCCC-DDDD', machineId: store.machineId() } });
    expect(product(r.status, 'addon.audio-lab')).toEqual({ state: { kind: 'locked' }, usable: true });
    expect(r.status.licence).toBeNull();
    expect(product(make().status(), 'addon.audio-lab').usable).toBe(false);
  });

  it('frees another seat and activates here', async () => {
    const { store, server } = setup();
    const r = await store.freeSeatAndActivate('GA-AAAA-BBBB-CCCC-DDDD', '0b9f6d0e-0000-4000-8000-000000000001');
    expect(server.calls.map((c) => c.path)).toEqual(['/api/license/deactivate', '/api/license/activate']);
    expect(server.calls[0].body).toEqual({ licenseKey: 'GA-AAAA-BBBB-CCCC-DDDD', machineRecordId: '0b9f6d0e-0000-4000-8000-000000000001' });
    expect(r.ok).toBe(true);
  });

  it('gives one 14-day emergency extension per licence after 30 days offline', async () => {
    const { store, clock, server, make } = setup();
    await store.activate('GA-AAAA-BBBB-CCCC-DDDD');
    server.reply = () => 'offline';
    clock.now = T0 + 24 * DAY;
    expect(store.status().offlineDaysLeft).toBe(6);
    clock.now = T0 + 31 * DAY;
    const fresh = make();
    expect(product(fresh.status(), 'addon.audio-lab')).toEqual({ state: { kind: 'expired', why: 'offline' }, usable: false });
    expect(fresh.status().licence.emergency.available).toBe(true);
    const r = fresh.useEmergencyExtension();
    expect(product(r.status, 'addon.audio-lab')).toEqual({ state: { kind: 'offline-grace', daysLeft: 14 }, usable: true });
    expect(r.status.licence.emergency.available).toBe(false);
    clock.now += 14 * DAY;
    const later = make();
    expect(product(later.status(), 'addon.audio-lab').state).toEqual({ kind: 'expired', why: 'offline' });
    expect(later.useEmergencyExtension()).toEqual({ ok: false, code: 'not_available' });
  });

  it('does not let a clock set back undo time already seen', async () => {
    const { store, clock, make } = setup();
    await store.activate('GA-AAAA-BBBB-CCCC-DDDD');
    clock.now = T0 + 31 * DAY;
    store.checkpoint();
    clock.now = T0 + 1 * DAY;
    expect(product(make().status(), 'addon.audio-lab').state).toEqual({ kind: 'expired', why: 'offline' });
  });

  it('ignores a stored file that is not JSON', () => {
    const { dir, make } = setup();
    make().machineId();
    writeFileSync(join(dir, 'licence', 'entitlement.json'), '{nope');
    writeFileSync(join(dir, 'licence', 'meta.json'), '[]');
    expect(product(make().status(), 'addon.audio-lab')).toEqual({ state: { kind: 'locked' }, usable: false });
  });
});

describe('licence server address', () => {
  it('is always ghostarcade.live in a packaged app; a development run may use a local server', () => {
    expect(ent.resolveApiBase({ isPackaged: true, env: { GA_LICENCE_API: 'http://localhost:1' } })).toBe('https://ghostarcade.live');
    expect(ent.resolveApiBase({ isPackaged: false, env: { GA_LICENCE_API: 'http://localhost:4100/x' } })).toBe('http://localhost:4100');
    expect(ent.resolveApiBase({ isPackaged: false, env: { GA_LICENCE_API: 'http://evil.example' } })).toBe('https://ghostarcade.live');
    expect(ent.resolveApiBase({ isPackaged: false, env: {} })).toBe('https://ghostarcade.live');
  });
});
