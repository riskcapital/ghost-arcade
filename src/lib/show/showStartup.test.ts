/**
 * Start at boot: the main-process config (electron/show-startup.cjs) with a
 * fake Electron `app`, so no test can ever register a real login item, and
 * the renderer's show-mode launch sequence.
 */

import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runShowModeLaunch, installPromptSuppression, type ShowStartupConfig } from './showStartup';

const require = createRequire(import.meta.url);
const { createShowStartup, defaultConfig } = require('../../../electron/show-startup.cjs');

function fakeApp(isPackaged: boolean, dir: string) {
  let openAtLogin = false;
  return {
    isPackaged,
    getPath: () => dir,
    setLoginItemSettings: vi.fn((s: { openAtLogin: boolean }) => { openAtLogin = s.openAtLogin; }),
    getLoginItemSettings: vi.fn(() => ({ openAtLogin })),
  };
}

function withDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'ga-show-startup-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('show startup config (main process)', () => {
  it('is all off by default and does not touch the login item to read it', () => withDir((dir) => {
    const app = fakeApp(true, dir);
    const s = createShowStartup({ app, argv: [], env: {} });
    expect(s.get().config).toEqual(defaultConfig());
    expect(s.get().config.launchAtLogin).toBe(false);
    expect(s.get().config.showMode).toBe(false);
    expect(app.setLoginItemSettings).not.toHaveBeenCalled();
  }));

  it('packaged: the explicit toggle registers and removes the login item', () => withDir((dir) => {
    const app = fakeApp(true, dir);
    const s = createShowStartup({ app, argv: [], env: {} });
    s.set({ showMode: true, projectPath: '/shows/lobby.gha' });
    expect(app.setLoginItemSettings).not.toHaveBeenCalled();
    const on = s.set({ launchAtLogin: true });
    expect(app.setLoginItemSettings).toHaveBeenLastCalledWith({ openAtLogin: true });
    expect(on.loginItem).toEqual({ enabled: true, simulated: false });
    s.set({ launchAtLogin: false });
    expect(app.setLoginItemSettings).toHaveBeenLastCalledWith({ openAtLogin: false });
    expect(JSON.parse(readFileSync(join(dir, 'show-startup.json'), 'utf8'))).toMatchObject({
      launchAtLogin: false, showMode: true, projectPath: '/shows/lobby.gha',
    });
  }));

  it('a development build only simulates the login item', () => withDir((dir) => {
    const app = fakeApp(false, dir);
    const s = createShowStartup({ app, argv: [], env: {} });
    const info = s.set({ launchAtLogin: true });
    expect(app.setLoginItemSettings).not.toHaveBeenCalled();
    expect(info.loginItem).toEqual({ enabled: true, simulated: true });
    expect(info.config.launchAtLogin).toBe(true);
  }));

  it('persists across launches and honours the --no-show-mode escape hatch', () => withDir((dir) => {
    const app = fakeApp(true, dir);
    createShowStartup({ app, argv: [], env: {} }).set({ showMode: true, autoStart: 'timeline' });
    const next = createShowStartup({ app, argv: [], env: {} }).get();
    expect(next.session).toEqual({ showMode: true, skipped: false });
    expect(next.config.autoStart).toBe('timeline');
    const skipped = createShowStartup({ app, argv: ['electron', '.', '--no-show-mode'], env: {} }).get();
    expect(skipped.session).toEqual({ showMode: false, skipped: true });
  }));

  it('ignores junk in the config file', () => withDir((dir) => {
    const app = fakeApp(true, dir);
    const s = createShowStartup({ app, argv: [], env: {} });
    const info = s.set({ autoStart: 'explode', openOutputs: 'yes', projectPath: 42 });
    expect(info.config).toMatchObject({ autoStart: 'go', openOutputs: true, projectPath: '' });
  }));
});

describe('show-mode launch sequence', () => {
  const config = (patch: Partial<ShowStartupConfig>): ShowStartupConfig => ({
    launchAtLogin: false, showMode: true, projectPath: '/shows/a.gha', openOutputs: true, autoStart: 'go', suppressPrompts: true, ...patch,
  });

  it('opens the project, then the outputs, then presses GO', async () => {
    const order: string[] = [];
    const steps = await runShowModeLaunch(config({}), {
      openProject: async (p) => { order.push(`open ${p}`); return true; },
      openOutputs: async () => { order.push('outputs'); },
      go: () => order.push('go'),
      playTimeline: () => order.push('play'),
    });
    expect(order).toEqual(['open /shows/a.gha', 'outputs', 'go']);
    expect(steps).toEqual(['opened /shows/a.gha', 'outputs open', 'GO']);
  });

  it('keeps going when a step fails, and can play the timeline instead', async () => {
    const order: string[] = [];
    await runShowModeLaunch(config({ autoStart: 'timeline' }), {
      openProject: async () => { throw new Error('ENOENT'); },
      openOutputs: async () => { throw new Error('no display'); },
      go: () => order.push('go'),
      playTimeline: () => order.push('play'),
    });
    expect(order).toEqual(['play']);
  });

  it('suppresses blocking prompts and restores them', () => {
    const g = globalThis as unknown as { window?: unknown; alert?: unknown; confirm?: unknown };
    const hadWindow = 'window' in g;
    const prevWindow = g.window;
    const alertSpy = vi.fn();
    const confirmSpy = vi.fn(() => true);
    g.window = { alert: alertSpy, confirm: confirmSpy };
    const notes: string[] = [];
    const restore = installPromptSuppression((m) => notes.push(m));
    const w = g.window as { alert(m: string): void; confirm(m: string): boolean };
    w.alert('Failed to load');
    expect(w.confirm('Delete?')).toBe(false);
    expect(alertSpy).not.toHaveBeenCalled();
    expect(notes).toEqual(['Failed to load']);
    restore();
    expect(w.alert).toBe(alertSpy);
    if (hadWindow) g.window = prevWindow;
    else delete g.window;
  });
});
