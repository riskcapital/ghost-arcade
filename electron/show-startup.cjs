/**
 * Start-at-boot for unattended shows.
 *
 * Two independent switches, both off by default:
 *   launchAtLogin  register the app as a login item (app.setLoginItemSettings)
 *   showMode       on every launch: open `projectPath`, open the outputs
 *                  fullscreen, start the show, and suppress prompts
 *
 * The config lives in userData/show-startup.json, beside the app's other
 * machine-level state: it belongs to the install, not to a project.
 *
 * A development (unpackaged) build never touches the real login item: it
 * would register the bare Electron binary to start at every login. The
 * switch is simulated in memory there unless GA_REAL_LOGIN_ITEM=1. Tests can
 * also inject their own `app`.
 *
 * Escape hatch: launching with --no-show-mode (or GA_SKIP_SHOW_MODE=1) opens
 * normally even when show mode is on, so an installer can get back in.
 */

'use strict';

const nodeFs = require('fs');
const nodePath = require('path');
const { writeFileAtomicSync } = require('./atomic-write.cjs');

const AUTO_START = ['none', 'go', 'timeline', 'playlist'];
const RESUME = ['clock', 'start'];
const QUIT_PROTECTION = ['confirm', 'combo'];
const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

const DOCUMENTS = ['show', 'timeline'];

/** Playlist items: a project file and which of its documents to play. */
function normalizePlaylist(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((x) => {
    if (typeof x === 'string' && x) return [{ path: x, document: 'show' }];
    if (x && typeof x === 'object' && typeof x.path === 'string' && x.path) {
      return [{ path: x.path, document: DOCUMENTS.includes(x.document) ? x.document : 'show' }];
    }
    return [];
  }).slice(0, 50);
}

function defaultSchedule() {
  return {
    enabled: false,
    days: Array.from({ length: 7 }, () => ({ enabled: true, on: '10:00', off: '18:00' })),
    projectorPower: false,
    warmupSeconds: 60,
    shutter: false,
  };
}

/** Same rules as src/lib/install/installSchedule.ts normalizeInstallSchedule. */
function normalizeSchedule(raw) {
  const d = defaultSchedule();
  if (!raw || typeof raw !== 'object') return d;
  const rawDays = Array.isArray(raw.days) ? raw.days : [];
  const days = d.days.map((def, i) => {
    const x = rawDays[i];
    if (!x || typeof x !== 'object') return def;
    return {
      enabled: x.enabled !== false,
      on: TIME_RE.test(String(x.on)) ? String(x.on) : def.on,
      off: TIME_RE.test(String(x.off)) ? String(x.off) : def.off,
    };
  });
  const warm = Number(raw.warmupSeconds);
  return {
    enabled: raw.enabled === true,
    days,
    projectorPower: raw.projectorPower === true,
    warmupSeconds: Number.isFinite(warm) ? Math.max(0, Math.min(600, Math.round(warm))) : d.warmupSeconds,
    shutter: raw.shutter === true,
  };
}

function defaultConfig() {
  return {
    launchAtLogin: false,
    showMode: false,
    projectPath: '',
    openOutputs: true,
    autoStart: 'go',
    suppressPrompts: true,
    // Install mode (unattended installation): see electron/install-mode.cjs.
    // What 'timeline' plays: the Show (presets along music) or the Timeline
    // (mapping-piece rows). Only one plays at a time.
    document: 'show',
    playlist: [],
    loopShow: true,
    schedule: defaultSchedule(),
    watchdog: true,
    relaunchOnCrash: true,
    resume: 'clock',
    hideCursor: true,
    quitProtection: 'confirm',
  };
}

function normalizeConfig(raw) {
  const d = defaultConfig();
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    launchAtLogin: r.launchAtLogin === true,
    showMode: r.showMode === true,
    projectPath: typeof r.projectPath === 'string' ? r.projectPath : d.projectPath,
    openOutputs: r.openOutputs !== false,
    autoStart: AUTO_START.includes(r.autoStart) ? r.autoStart : d.autoStart,
    suppressPrompts: r.suppressPrompts !== false,
    playlist: normalizePlaylist(r.playlist),
    document: DOCUMENTS.includes(r.document) ? r.document : d.document,
    loopShow: r.loopShow !== false,
    schedule: normalizeSchedule(r.schedule),
    watchdog: r.watchdog !== false,
    relaunchOnCrash: r.relaunchOnCrash !== false,
    resume: RESUME.includes(r.resume) ? r.resume : d.resume,
    hideCursor: r.hideCursor !== false,
    quitProtection: QUIT_PROTECTION.includes(r.quitProtection) ? r.quitProtection : d.quitProtection,
  };
}

/**
 * Linux has no login-item API in Electron: an XDG autostart entry does the
 * same job on every common desktop (GNOME, KDE, Xfce, ...). An AppImage
 * starts from its own path ($APPIMAGE), not the mounted copy.
 */
function linuxAutostartFile({ homedir, env, name }) {
  const base = env.XDG_CONFIG_HOME || nodePath.join(homedir, '.config');
  return nodePath.join(base, 'autostart', `${name}.desktop`);
}

function linuxAutostartEntry({ name, exec }) {
  const quoted = /[\s"'\\]/.test(exec) ? `"${exec.replace(/(["\\`$])/g, '\\$1')}"` : exec;
  return [
    '[Desktop Entry]',
    'Type=Application',
    `Name=${name}`,
    `Exec=${quoted}`,
    'X-GNOME-Autostart-enabled=true',
    'X-GNOME-Autostart-Delay=5',
    'Terminal=false',
    '',
  ].join('\n');
}

function createShowStartup({ app, fs = nodeFs, path = nodePath, argv = process.argv, env = process.env, platform = process.platform, homedir = null, execPath = process.execPath } = {}) {
  const file = path.join(app.getPath('userData'), 'show-startup.json');
  const mockLoginItem = !app.isPackaged && env.GA_REAL_LOGIN_ITEM !== '1';
  let simulatedLogin = false;
  let config = defaultConfig();
  try {
    config = normalizeConfig(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    config = defaultConfig();
  }
  if (mockLoginItem) simulatedLogin = config.launchAtLogin;
  const skip = argv.includes('--no-show-mode') || env.GA_SKIP_SHOW_MODE === '1';

  const autostartName = (() => {
    try { return String(app.getName ? app.getName() : 'ghost-arcade').replace(/[^A-Za-z0-9._-]+/g, '-').toLowerCase(); } catch { return 'ghost-arcade'; }
  })();
  const autostartFile = platform === 'linux'
    ? linuxAutostartFile({ homedir: homedir || require('os').homedir(), env, name: autostartName })
    : null;

  function loginItemEnabled() {
    if (mockLoginItem) return simulatedLogin;
    if (autostartFile) return fs.existsSync(autostartFile);
    try {
      return !!app.getLoginItemSettings().openAtLogin;
    } catch {
      return false;
    }
  }

  function setLoginItem(enabled) {
    if (mockLoginItem) {
      simulatedLogin = !!enabled;
      return;
    }
    if (autostartFile) {
      if (enabled) {
        fs.mkdirSync(path.dirname(autostartFile), { recursive: true });
        const name = (() => { try { return app.getName(); } catch { return 'Ghost Arcade'; } })();
        writeFileAtomicSync(autostartFile, linuxAutostartEntry({ name, exec: env.APPIMAGE || execPath }), { fs });
      } else {
        fs.rmSync(autostartFile, { force: true });
      }
      return;
    }
    // macOS: a login item for the app bundle. Windows: the Run key, with the
    // installed executable's own path.
    app.setLoginItemSettings(platform === 'win32'
      ? { openAtLogin: !!enabled, path: execPath, args: [] }
      : { openAtLogin: !!enabled });
  }

  function save() {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      writeFileAtomicSync(file, JSON.stringify(config, null, 2), { fs });
    } catch (err) {
      console.warn('[ShowStartup] could not save config:', err && err.message);
    }
  }

  function describe() {
    return {
      config: { ...config },
      loginItem: { enabled: loginItemEnabled(), simulated: mockLoginItem, ...(autostartFile ? { file: autostartFile } : {}) },
      // What THIS launch does: show mode unless skipped.
      session: { showMode: config.showMode && !skip, skipped: config.showMode && skip },
    };
  }

  return {
    file,
    get: describe,
    /** Apply a patch. Only an explicit change of launchAtLogin touches the
     *  login item, and the stored flag follows what the OS reports. */
    set(patch) {
      const p = patch && typeof patch === 'object' ? patch : {};
      const next = normalizeConfig({ ...config, ...p });
      if (Object.prototype.hasOwnProperty.call(p, 'launchAtLogin')) {
        if (next.launchAtLogin !== loginItemEnabled()) {
          try {
            setLoginItem(next.launchAtLogin);
          } catch (err) {
            console.warn('[ShowStartup] login item change failed:', err && err.message);
          }
        }
        next.launchAtLogin = loginItemEnabled();
      }
      config = next;
      save();
      return describe();
    },
  };
}

module.exports = { createShowStartup, normalizeConfig, defaultConfig, normalizeSchedule, normalizePlaylist, linuxAutostartEntry };
