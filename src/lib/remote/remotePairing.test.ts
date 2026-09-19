import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The renderer half of pairing: how the token gets into URLs and requests,
 * and how a phone tells a refused token from a network problem.
 */

async function load() {
  vi.resetModules();
  return import('./remotePairing');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('pairing code text', () => {
  it('groups a token for reading and strips a typed one back down', async () => {
    const { formatPairingCode, cleanPairingCode } = await load();
    expect(formatPairingCode('ABCD0EFGH1JKMN2P')).toBe('ABCD-0EFG-H1JK-MN2P');
    expect(cleanPairingCode(' abcd-0efg h1jk-mn2p ')).toBe('ABCD0EFGH1JKMN2P');
    expect(formatPairingCode('')).toBe('');
  });
});

describe('withPairingToken', () => {
  it('adds the token as ?pair= to a WebSocket URL', async () => {
    const { withPairingToken } = await load();
    expect(withPairingToken('ws://192.168.1.5:9001', 'TOKEN')).toBe('ws://192.168.1.5:9001/?pair=TOKEN');
    expect(withPairingToken('ws://host:9001/?a=1&pair=OLD', 'NEW')).toBe('ws://host:9001/?a=1&pair=NEW');
  });

  it('leaves a URL alone when there is no token or it cannot be parsed', async () => {
    const { withPairingToken } = await load();
    expect(withPairingToken('ws://host:9001', '')).toBe('ws://host:9001');
    expect(withPairingToken('not a url', 'TOKEN')).toBe('not a url');
  });
});

describe('checkPairing', () => {
  it('asks /pair/check on the WebSocket host and port', async () => {
    const { pairingCheckUrl } = await load();
    expect(pairingCheckUrl('ws://192.168.1.5:9011/?pair=X', 'TOKEN')).toBe('http://192.168.1.5:9011/pair/check?pair=TOKEN');
    expect(pairingCheckUrl('wss://host:9001', 'T')).toBe('https://host:9001/pair/check?pair=T');
    expect(pairingCheckUrl('nonsense', 'T')).toBeNull();
  });

  it('tells a refused token from an unreachable server', async () => {
    const { checkPairing } = await load();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })));
    expect(await checkPairing('ws://host:9001', 'T')).toBe('unpaired');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
    expect(await checkPairing('ws://host:9001', 'T')).toBe('paired');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    expect(await checkPairing('ws://host:9001', 'T')).toBe('unreachable');
  });
});

describe('desktop requests to the local server', () => {
  it('carry the token and use the port main reports', async () => {
    const fetchMock = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', {
      ghostRemote: { info: async () => ({ token: 'TOKEN', wsPort: 9011, httpPort: 9012 }), reset: async () => null },
    });
    const { localServerFetch, getRemotePairingInfo } = await load();
    expect(await getRemotePairingInfo()).toEqual({ token: 'TOKEN', wsPort: 9011, httpPort: 9012 });

    await localServerFetch('/api/shaders', { method: 'POST' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://localhost:9012/api/shaders');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer TOKEN');
  });

  it('pick up the new token after a reset', async () => {
    let token = 'OLD';
    vi.stubGlobal('window', {
      ghostRemote: {
        info: async () => ({ token, wsPort: 9001, httpPort: 9002 }),
        reset: async () => { token = 'NEW'; return { token, wsPort: 9001, httpPort: 9002 }; },
      },
    });
    const { getRemotePairingInfo, resetRemotePairing } = await load();
    expect((await getRemotePairingInfo())?.token).toBe('OLD');
    expect((await resetRemotePairing())?.token).toBe('NEW');
    expect((await getRemotePairingInfo())?.token).toBe('NEW');
  });

  it('fall back to the defaults outside the desktop app', async () => {
    const fetchMock = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    const { localServerFetch, getRemotePairingInfo } = await load();
    expect(await getRemotePairingInfo()).toBeNull();
    await localServerFetch('/info');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://localhost:9002/info');
    expect(new Headers(init.headers).has('Authorization')).toBe(false);
  });
});

describe('the phone remembering its code', () => {
  function memoryStorage() {
    const data = new Map<string, string>();
    return {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    };
  }

  it('keeps it across loads until it is refused', async () => {
    vi.stubGlobal('localStorage', memoryStorage());
    const { rememberPairingToken, recallPairingToken, forgetPairingToken } = await load();
    expect(recallPairingToken()).toBe('');
    expect(rememberPairingToken('ABCD0EFGH1JKMN2P')).toBe(true);
    expect(recallPairingToken()).toBe('ABCD0EFGH1JKMN2P');
    forgetPairingToken();
    expect(recallPairingToken()).toBe('');
  });

  it('copes with storage that throws, as in private browsing', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
      removeItem: () => { throw new Error('denied'); },
    });
    const { rememberPairingToken, recallPairingToken, forgetPairingToken } = await load();
    expect(rememberPairingToken('ABCD0EFGH1JKMN2P')).toBe(false);
    expect(recallPairingToken()).toBe('');
    expect(() => forgetPairingToken()).not.toThrow();
  });
});
