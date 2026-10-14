/**
 * Start-at-boot for unattended shows.
 *
 * Two independent switches, both off by default:
 *   launchAtLogin  register the app as a login item: app.setLoginItemSettings
 *                  on macOS and Windows, an XDG autostart entry on Linux,
 *                  where Electron has no login item of its own
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
const nodeOs = require('os');
const nodePath = require('path');

const AUTO_START = ['none', 'go', 'timeline'];

function defaultConfig() {
  return {
    launchAtLogin: false,
    showMode: false,
    projectPath: '',
    openOutputs: true,
    autoStart: 'go',
    suppressPrompts: true,
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
  };
}

/** An Exec argument quoted the way the desktop entry specification reads it. */
function desktopExecQuote(value) {
  return `"${String(value).replace(/(["`$\\])/g, '\\$1')}"`;
}

/**
 * The Linux login item: a desktop entry in the user's autostart folder,
 * which every freedesktop session starts at login. An AppImage is started
 * through its own file (APPIMAGE), not the path it is mounted at for this
 * run, which is gone by the next login.
 */
function createLinuxLoginItem({ fs, path, env, execPath, home }) {
  const configDir = env.XDG_CONFIG_HOME && path.isAbsolute(env.XDG_CONFIG_HOME)
    ? env.XDG_CONFIG_HOME
    : path.join(home, '.config');
  const entry = path.join(configDir, 'autostart', 'ghost-arcade.desktop');
  return {
    entry,
    enabled() {
      try {
        return !/^Hidden=true$/m.test(fs.readFileSync(entry, 'utf8'));
      } catch {
        return false;
      }
    },
    set(enabled) {
      if (!enabled) {
        fs.rmSync(entry, { force: true });
        return;
      }
      fs.mkdirSync(path.dirname(entry), { recursive: true });
      fs.writeFileSync(entry, [
        '[Desktop Entry]',
        'Type=Application',
        'Name=Ghost Arcade',
        `Exec=${desktopExecQuote(env.APPIMAGE || execPath)}`,
        'Terminal=false',
        'X-GNOME-Autostart-enabled=true',
        '',
      ].join('\n'));
    },
  };
}

function createShowStartup({
  app, fs = nodeFs, path = nodePath, argv = process.argv, env = process.env,
  platform = process.platform, execPath = process.execPath, home = nodeOs.homedir(),
} = {}) {
  const file = path.join(app.getPath('userData'), 'show-startup.json');
  const linuxLoginItem = platform === 'linux'
    ? createLinuxLoginItem({ fs, path, env, execPath, home })
    : null;
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

  function loginItemEnabled() {
    if (mockLoginItem) return simulatedLogin;
    if (linuxLoginItem) return linuxLoginItem.enabled();
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
    if (linuxLoginItem) {
      linuxLoginItem.set(!!enabled);
      return;
    }
    app.setLoginItemSettings({ openAtLogin: !!enabled });
  }

  function save() {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(config, null, 2));
    } catch (err) {
      console.warn('[ShowStartup] could not save config:', err && err.message);
    }
  }

  function describe() {
    return {
      config: { ...config },
      loginItem: { enabled: loginItemEnabled(), simulated: mockLoginItem },
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

module.exports = { createShowStartup, normalizeConfig, defaultConfig };
