import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

/**
 * The CORS-free HTTP proxy (http_fetch and friends) had a host allowlist
 * that logged "Blocked host" and then fetched anyway, unless the host was a
 * private IPv4 literal. It now refuses every host that is not listed.
 */

const require = createRequire(import.meta.url);
const electronDir = join(process.cwd(), 'electron');
const mainSource = readFileSync(join(electronDir, 'main.js'), 'utf8');

function mainHandler(name: string): string {
  const start = mainSource.indexOf(`ipcMain.handle('${name}'`);
  expect(start, `${name} handler not found`).toBeGreaterThan(-1);
  const next = mainSource.indexOf('ipcMain.handle(', start + 1);
  return mainSource.slice(start, next === -1 ? undefined : next);
}

describe('hosts the HTTP proxy may reach', () => {
  const { validateProxyUrl } = require(join(electronDir, 'proxy-url.cjs'));

  it('refuses a host that is not on the list', () => {
    for (const url of [
      'https://example.com/collect',
      'https://evil-ghostarcade.live/api',
      'https://ghostarcade.live.example.com/api',
      'http://192.168.1.1/admin',
      'http://10.0.0.5:8080/',
      'http://169.254.169.254/latest/meta-data/',
      'http://8.8.8.8/',
      'http://[::1]:9000/',
      'http://0.0.0.0/',
    ]) {
      expect(() => validateProxyUrl(url), url).toThrow();
    }
  });

  it('refuses anything that is not http or https', () => {
    expect(() => validateProxyUrl('file:///etc/passwd')).toThrow();
    expect(() => validateProxyUrl('ftp://ghostarcade.live/x')).toThrow();
    expect(() => validateProxyUrl('not a url')).toThrow();
  });

  it('allows the hosts the app calls', () => {
    for (const url of [
      // Director chat and support (src/lib/director/DirectorClient.ts)
      'https://ghostarcade.live/api/director/chat',
      'https://ghostarcade.live/api/director/support',
      'http://localhost:3000/api/director/chat',
      // Luma video generation and its finished-video download (src/lib/api/ai-client.ts)
      'https://api.lumalabs.ai/dream-machine/v1/generations',
      'https://storage.cdn-luma.com/dream_machine/abc/video.mp4',
    ]) {
      expect(() => validateProxyUrl(url), url).not.toThrow();
    }
  });

  it('checks the URL in every proxy handler before fetching', () => {
    for (const name of ['http_fetch', 'http_fetch_stream', 'http_fetch_binary', 'http_put_binary']) {
      const handler = mainHandler(name);
      const check = handler.indexOf('validateProxyUrl(url)');
      expect(check, name).toBeGreaterThan(-1);
      expect(check, name).toBeLessThan(handler.indexOf('await fetch('));
    }
    expect(mainSource).toContain("require('./proxy-url.cjs')");
    expect(mainSource).not.toContain('function validateProxyUrl');
  });
});
