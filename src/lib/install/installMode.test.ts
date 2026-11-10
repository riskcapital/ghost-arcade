/**
 * Install mode in the main process (electron/install-mode.cjs) with fake
 * Electron pieces, its settings (electron/show-startup.cjs), the login item
 * on each platform, and the health log's rotation.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { createShowStartup, defaultConfig } = require('../../../electron/show-startup.cjs');
const { createInstallMode } = require('../../../electron/install-mode.cjs');
const { createHealthLog } = require('../../../electron/install-health-log.cjs');

const dirs: string[] = [];
function tmp() {
  const d = mkdtempSync(join(tmpdir(), 'ga-install-'));
  dirs.push(d);
  return d;
}
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function fakeApp(dir: string, isPackaged = true) {
  let openAtLogin = false;
  return {
    isPackaged,
    getPath: () => dir,
    getName: () => 'Ghost Arcade Pro',
    setLoginItemSettings: vi.fn((s: { openAtLogin: boolean }) => { openAtLogin = s.openAtLogin; }),
    getLoginItemSettings: vi.fn(() => ({ openAtLogin })),
    relaunch: vi.fn(),
    exit: vi.fn(),
    quit: vi.fn(),
  };
}

describe('install settings persistence', () => {
  it('saves every install field and reads it back on the next launch', () => {
    const dir = tmp();
    const app = fakeApp(dir);
    const a = createShowStartup({ app, argv: [], env: {} });
    const schedule = { enabled: true, days: Array.from({ length: 7 }, (_, i) => ({ enabled: i !== 1, on: '09:30', off: '01:00' })), projectorPower: true, warmupSeconds: 90, shutter: true };
    a.set({
      showMode: true, autoStart: 'playlist', document: 'timeline',
      playlist: [{ path: '/a.gha', document: 'show' }, { path: '/b.gha', document: 'timeline' }],
      loopShow: false, schedule, watchdog: false, relaunchOnCrash: false, resume: 'start', hideCursor: false, quitProtection: 'combo',
    });
    const b = createShowStartup({ app, argv: [], env: {} }).get().config;
    expect(b).toMatchObject({ showMode: true, autoStart: 'playlist', document: 'timeline', loopShow: false, watchdog: false, relaunchOnCrash: false, resume: 'start', hideCursor: false, quitProtection: 'combo' });
    expect(b.playlist).toEqual([{ path: '/a.gha', document: 'show' }, { path: '/b.gha', document: 'timeline' }]);
    expect(b.schedule).toEqual(schedule);
    expect(JSON.parse(readFileSync(join(dir, 'show-startup.json'), 'utf8')).schedule.warmupSeconds).toBe(90);
  });

  it('defaults are safe for an install and old files still load', () => {
    const d = defaultConfig();
    expect(d).toMatchObject({ watchdog: true, relaunchOnCrash: true, hideCursor: true, quitProtection: 'confirm', resume: 'clock', loopShow: true, document: 'show' });
    expect(d.schedule.enabled).toBe(false);
  });
});

describe('start on login', () => {
  it('macOS: a login item for the app', () => {
    const app = fakeApp(tmp());
    const s = createShowStartup({ app, argv: [], env: {}, platform: 'darwin' });
    expect(s.set({ launchAtLogin: true }).loginItem.enabled).toBe(true);
    expect(app.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true });
  });

  it('Windows: the Run key with the installed executable', () => {
    const app = fakeApp(tmp());
    const s = createShowStartup({ app, argv: [], env: {}, platform: 'win32', execPath: 'C:\\Program Files\\Ghost Arcade Pro\\Ghost Arcade Pro.exe' });
    s.set({ launchAtLogin: true });
    expect(app.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true, path: 'C:\\Program Files\\Ghost Arcade Pro\\Ghost Arcade Pro.exe', args: [] });
  });

  it('Linux: an XDG autostart entry, removed again when switched off', () => {
    const home = tmp();
    const app = fakeApp(tmp());
    const s = createShowStartup({ app, argv: [], env: { APPIMAGE: '/home/j/Apps/Ghost Arcade Pro.AppImage' }, platform: 'linux', homedir: home });
    const info = s.set({ launchAtLogin: true });
    const file = join(home, '.config', 'autostart', 'ghost-arcade-pro.desktop');
    expect(info.loginItem).toMatchObject({ enabled: true, file });
    const text = readFileSync(file, 'utf8');
    expect(text).toContain('[Desktop Entry]');
    expect(text).toContain('Exec="/home/j/Apps/Ghost Arcade Pro.AppImage"');
    expect(app.setLoginItemSettings).not.toHaveBeenCalled();
    expect(s.set({ launchAtLogin: false }).loginItem.enabled).toBe(false);
    expect(existsSync(file)).toBe(false);
  });

  it('a development build only simulates it', () => {
    const app = fakeApp(tmp(), false);
    const s = createShowStartup({ app, argv: [], env: {}, platform: 'linux', homedir: tmp() });
    expect(s.set({ launchAtLogin: true }).loginItem).toMatchObject({ enabled: true, simulated: true });
    expect(app.setLoginItemSettings).not.toHaveBeenCalled();
  });
});

function setup(opts: { showMode?: boolean; argv?: string[]; config?: Record<string, unknown> } = {}) {
  const dir = tmp();
  const app = fakeApp(dir);
  const startup = createShowStartup({ app, argv: opts.argv ?? [], env: {} });
  startup.set({ showMode: opts.showMode ?? true, ...(opts.config ?? {}) });
  let t = 1_000_000;
  const sent: string[] = [];
  const wc = {
    isLoading: () => false, isCrashed: () => false, reload: vi.fn(), forcefullyCrashRenderer: vi.fn(),
    send: (ch: string) => sent.push(ch), insertCSS: vi.fn(async () => 'key1'), removeInsertedCSS: vi.fn(async () => {}),
  };
  const win = { isDestroyed: () => false, webContents: wc, show: vi.fn(), focus: vi.fn() };
  const shortcuts = new Map<string, () => void>();
  const dialog = { showMessageBox: vi.fn(async () => ({ response: 0 })) };
  const broker = { getProcessId: vi.fn(() => 4242 as number | null), coreInstance: 1, sendIfRunning: vi.fn(async () => ({ frames_submitted: 1 }) as unknown) };
  const spawn = vi.fn(() => ({ pid: 999999, unref: () => {} }));
  const im = createInstallMode({
    app, showStartup: startup, getMainWindow: () => win, broker, dialog,
    globalShortcut: { register: (acc: string, fn: () => void) => { shortcuts.set(acc, fn); return true; }, unregister: (acc: string) => shortcuts.delete(acc) },
    powerMonitor: { on: () => {} }, isPowerBlockerActive: () => true, getOutputWindows: () => [],
    spawn, now: () => t, setInterval: () => 0, clearInterval: () => {},
    guardianSource: '// guardian', argv: ['electron', '.', '--remote-debugging-port=9361'], execPath: '/bin/electron', cwd: dir, pid: 12345,
  });
  return { dir, app, im, win, wc, sent, shortcuts, dialog, broker, spawn, startup, advance: (ms: number) => { t += ms; } };
}

describe('install mode (main process)', () => {
  it('is off unless this launch is in show mode, and --no-show-mode skips it', () => {
    expect(setup({ showMode: false }).im.active()).toBe(false);
    expect(setup({ argv: ['--no-show-mode'] }).im.active()).toBe(false);
    expect(setup().im.active()).toBe(true);
  });

  it('starts: health log, guardian with the same command line, exit key combo', () => {
    const h = setup();
    expect(h.im.start()).toBe(true);
    expect(h.spawn).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = h.spawn.mock.calls[0] as unknown as [string, string[], { env: Record<string, string>; detached: boolean }];
    expect(cmd).toBe('/bin/electron');
    expect(args[0]).toBe(join(h.dir, 'install-guardian.cjs'));
    expect(opts.detached).toBe(true);
    expect(opts.env.ELECTRON_RUN_AS_NODE).toBe('1');
    expect(JSON.parse(opts.env.GA_GUARDIAN_CONFIG)).toMatchObject({ pid: 12345, command: '/bin/electron', args: ['.', '--remote-debugging-port=9361'] });
    expect(h.shortcuts.has('CommandOrControl+Alt+Shift+X')).toBe(true);
    const log = readFileSync(h.im.logFile, 'utf8');
    expect(log).toMatch(/start\s+install mode on/);
    expect(JSON.parse(readFileSync(h.im.stateFile, 'utf8'))).toMatchObject({ cleanExit: false, guardianPid: 999999 });
  });

  it('the exit key combo leaves install mode for the session', () => {
    const h = setup();
    h.im.start();
    h.shortcuts.get('CommandOrControl+Alt+Shift+X')!();
    expect(h.im.active()).toBe(false);
    expect(h.sent).toContain('install-mode-paused');
    expect(JSON.parse(readFileSync(h.im.stateFile, 'utf8')).cleanExit).toBe(true);
    expect(h.im.holdQuit()).toBe(false);
  });

  it('holds a quit with a question (default: keep running)', async () => {
    const h = setup();
    h.im.start();
    expect(h.im.holdQuit()).toBe(true);
    expect(h.dialog.showMessageBox).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(h.app.quit).not.toHaveBeenCalled();
  });

  it('quits when the question is answered Quit', async () => {
    const h = setup();
    h.dialog.showMessageBox.mockResolvedValueOnce({ response: 1 });
    h.im.start();
    expect(h.im.holdQuit()).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(h.app.quit).toHaveBeenCalled();
    expect(h.im.holdQuit()).toBe(false);
  });

  it('in combo mode refuses a quit outright', () => {
    const h = setup({ config: { quitProtection: 'combo' } });
    h.im.start();
    expect(h.im.holdQuit()).toBe(true);
    expect(h.dialog.showMessageBox).not.toHaveBeenCalled();
    expect(h.sent).toContain('install-mode-quit-refused');
  });

  it('reloads an editor that stopped sending its heartbeat', () => {
    vi.useFakeTimers();
    try {
      const h = setup();
      h.im.start();
      h.im.pageLoaded();
      h.im.heartbeat({ state: 'on' });
      h.advance(10_000);
      h.im._checkHeartbeat();
      expect(h.wc.forcefullyCrashRenderer).not.toHaveBeenCalled();
      h.advance(15_000);
      h.im._checkHeartbeat();
      expect(h.wc.forcefullyCrashRenderer).toHaveBeenCalled();
      vi.advanceTimersByTime(600);
      expect(h.wc.reload).toHaveBeenCalled();
      expect(readFileSync(h.im.logFile, 'utf8')).toMatch(/restart\s+the editor has not answered/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('handles an editor crash itself and escalates a crash loop to a relaunch', () => {
    vi.useFakeTimers();
    try {
      const h = setup();
      h.im.start();
      for (let i = 0; i < 3; i++) expect(h.im.rendererGone({ reason: 'crashed', exitCode: 11 })).toBe(true);
      vi.advanceTimersByTime(600);
      expect(h.wc.reload).toHaveBeenCalledTimes(3);
      h.im.rendererGone({ reason: 'crashed', exitCode: 11 });
      expect(h.app.exit).toHaveBeenCalled();
      expect(JSON.parse(readFileSync(h.im.stateFile, 'utf8')).history.relaunches).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ends a render core whose frame count stopped', async () => {
    const h = setup();
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
    try {
      h.im.start();
      for (let i = 0; i < 6; i++) {
        await h.im._checkCore();
        h.advance(5000);
      }
      expect(kill).toHaveBeenCalledWith(4242, 'SIGKILL');
      expect(readFileSync(h.im.logFile, 'utf8')).toMatch(/no new frame from the render core/);
    } finally {
      kill.mockRestore();
    }
  });

  it('leaves the core alone while its frames advance', async () => {
    const h = setup();
    let frames = 0;
    h.broker.sendIfRunning.mockImplementation(async () => ({ frames_submitted: ++frames }));
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
    try {
      h.im.start();
      for (let i = 0; i < 10; i++) { await h.im._checkCore(); h.advance(5000); }
      expect(kill).not.toHaveBeenCalledWith(4242, 'SIGKILL');
    } finally {
      kill.mockRestore();
    }
  });

  it('keeps the show anchor across a restart', () => {
    const h = setup();
    h.im.start();
    h.im.heartbeat({ anchor: { anchorMs: 5000, periodKey: 'always', projectPath: '/a.gha' } });
    const again = createInstallMode({ app: h.app, showStartup: h.startup, getMainWindow: () => null, spawn: h.spawn, setInterval: () => 0, clearInterval: () => {}, guardianSource: '' });
    expect(again.anchor()).toMatchObject({ anchorMs: 5000, periodKey: 'always', projectPath: '/a.gha' });
  });

  it('a clean quit tells the guardian not to relaunch', () => {
    const h = setup();
    h.im.start();
    h.im.markCleanExit();
    expect(JSON.parse(readFileSync(h.im.stateFile, 'utf8')).cleanExit).toBe(true);
  });
});

describe('health log', () => {
  it('rotates by size and keeps a bounded number of files', () => {
    const dir = tmp();
    const log = createHealthLog({ dir, maxBytes: 300, keep: 3 });
    for (let i = 0; i < 40; i++) log.write('restart', `event number ${i} with some words`);
    const files = readdirSync(dir).sort();
    expect(files).toEqual(['installation.1.log', 'installation.2.log', 'installation.3.log', 'installation.log']);
    expect(readFileSync(join(dir, 'installation.log'), 'utf8')).toContain('event number 39');
    expect(log.recent(2).map((e: { message: string }) => e.message)).toEqual(['event number 38 with some words', 'event number 39 with some words']);
  });

  it('stamps lines with the local UTC offset', () => {
    const dir = tmp();
    const log = createHealthLog({ dir, now: () => Date.parse('2026-01-05T15:00:00Z') });
    log.write('start', 'hello');
    expect(readFileSync(join(dir, 'installation.log'), 'utf8')).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d[+-]\d\d:\d\d  start\s+hello\n$/);
  });
});
