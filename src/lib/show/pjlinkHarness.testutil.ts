/**
 * Test wiring for projectors: the real main-process credential store
 * (electron/pjlink-credentials.cjs) over a fake safeStorage in a temp dir,
 * the real PJLink client reading passwords from it, and the renderer
 * projector store pointed at both, exactly as the IPC bridge connects them
 * in the app. Imported by tests only.
 */

import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setPjlinkTransport, setProjectorCredentialStore, type PjlinkRequest } from './projectors';

const require = createRequire(import.meta.url);
const { createPjlinkClient } = require('../../../electron/pjlink.cjs');
const { createPjlinkCredentials } = require('../../../electron/pjlink-credentials.cjs');

/** Reversible stand-in for Electron safeStorage. Ciphertext never contains
 *  the password's bytes in order. */
export function fakeSafeStorage(available = true) {
  const state = { available, encryptCalls: 0 };
  return {
    state,
    isEncryptionAvailable: () => state.available,
    encryptString(text: string): Buffer {
      state.encryptCalls++;
      return Buffer.from('enc1:' + Buffer.from(text, 'utf8').toString('hex').split('').reverse().join(''), 'utf8');
    },
    decryptString(buf: Buffer): string {
      const s = buf.toString('utf8');
      if (!s.startsWith('enc1:')) throw new Error('not ours');
      return Buffer.from(s.slice(5).split('').reverse().join(''), 'hex').toString('utf8');
    },
  };
}

export interface ProjectorHarness {
  dir: string;
  safeStorage: ReturnType<typeof fakeSafeStorage>;
  credentials: {
    file: string;
    set(id: string, pw: string): { ok: boolean; persisted: boolean; error?: string };
    has(id: string): { ok: boolean; has: boolean; persisted: boolean };
    get(id: string): string;
  };
  requests: PjlinkRequest[];
  dispose(): void;
}

/** Wire the projector store to a real credential store and PJLink client. */
export function installProjectorHarness({ encryption = true, timeoutMs }: { encryption?: boolean; timeoutMs?: number } = {}): ProjectorHarness {
  const dir = mkdtempSync(join(tmpdir(), 'ga-pjlink-creds-'));
  const safeStorage = fakeSafeStorage(encryption);
  const credentials = createPjlinkCredentials({ safeStorage, dir });
  const client = createPjlinkClient({ credentials });
  const requests: PjlinkRequest[] = [];
  setPjlinkTransport((req) => {
    requests.push(req);
    return client.run({ ...req, ...(timeoutMs ? { timeoutMs } : {}) });
  });
  setProjectorCredentialStore({
    set: async (id, pw) => credentials.set(id, pw),
    has: async (id) => credentials.has(id),
  });
  return {
    dir,
    safeStorage,
    credentials,
    requests,
    dispose() {
      setPjlinkTransport(null);
      setProjectorCredentialStore(null);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
