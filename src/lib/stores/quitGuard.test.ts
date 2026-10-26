import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const { createQuitGuard } = createRequire(import.meta.url)('../../../electron/quit-guard.cjs');

/**
 * Cmd+Q, Quit in the Dock and logging out used to exit without asking, so
 * unsaved work was lost. The quit is now held while the editor is asked.
 */
function guard(canAsk = true) {
  const ask = vi.fn(() => canAsk);
  const quit = vi.fn();
  return { g: createQuitGuard({ ask, quit, ackTimeoutMs: 3000 }), ask, quit };
}

afterEach(() => vi.useRealTimers());

describe('quit guard', () => {
  it('holds the quit and asks the editor', () => {
    const { g, ask, quit } = guard();
    expect(g.shouldHoldQuit()).toBe(true);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(quit).not.toHaveBeenCalled();
  });

  it('quits when the editor says go ahead, and does not ask again', () => {
    const { g, ask, quit } = guard();
    g.shouldHoldQuit();
    g.acknowledged();
    g.proceed();
    expect(quit).toHaveBeenCalledTimes(1);
    expect(g.shouldHoldQuit()).toBe(false);
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it('keeps running when the user cancels, and asks again on the next quit', () => {
    const { g, ask, quit } = guard();
    g.shouldHoldQuit();
    g.acknowledged();
    g.cancel();
    expect(quit).not.toHaveBeenCalled();
    expect(g.shouldHoldQuit()).toBe(true);
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it('waits for the user however long they take once the editor has answered', () => {
    vi.useFakeTimers();
    const { g, quit } = guard();
    g.shouldHoldQuit();
    g.acknowledged();
    vi.advanceTimersByTime(60_000);
    expect(quit).not.toHaveBeenCalled();
    // A second Cmd+Q while the prompt is up keeps waiting for it.
    expect(g.shouldHoldQuit()).toBe(true);
  });

  it('quits anyway when the editor never answers', () => {
    vi.useFakeTimers();
    const { g, quit } = guard();
    g.shouldHoldQuit();
    vi.advanceTimersByTime(3000);
    expect(quit).toHaveBeenCalledTimes(1);
  });

  it('does not hold the quit when there is no editor to ask', () => {
    const { g, quit } = guard(false);
    expect(g.shouldHoldQuit()).toBe(false);
    expect(quit).not.toHaveBeenCalled();
  });
});

describe('quit wiring', () => {
  const electron = join(process.cwd(), 'electron');
  const main = readFileSync(join(electron, 'main.js'), 'utf8');
  const preload = readFileSync(join(electron, 'preload.cjs'), 'utf8');

  it('routes before-quit through the guard', () => {
    const at = main.indexOf("app.on('before-quit', (event)");
    expect(at).toBeGreaterThan(-1);
    const beforeQuit = main.slice(at, at + 400);
    expect(beforeQuit).toContain('quitGuard.shouldHoldQuit()');
    for (const channel of ['app_quit_ack', 'app_quit_proceed', 'app_quit_cancel']) {
      expect(main).toContain(`ipcMain.handle('${channel}'`);
    }
  });

  it('lets the editor hear the request and answer it', () => {
    for (const channel of ['app_quit_ack', 'app_quit_proceed', 'app_quit_cancel']) {
      expect(preload).toContain(`'${channel}'`);
    }
    const onAllowlist = preload.slice(preload.indexOf('on: (channel, callback)'), preload.indexOf('on: (channel, callback)') + 600);
    expect(onAllowlist).toContain("'app-quit-requested'");
  });
});
