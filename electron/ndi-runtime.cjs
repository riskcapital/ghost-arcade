const fs = require('node:fs');
const path = require('node:path');

// The SDK import library needs the separately installed Windows runtime at
// addon load time. NDI's installer publishes its location through this env var.
// Do not copy the runtime into the application or depend on the shell's PATH.
function loadWithNdiRuntime(addonPath, load = require, env = process.env, platform = process.platform) {
  if (platform !== 'win32') return load(addonPath);
  const directories = Object.keys(env)
    .filter(key => /^NDI_RUNTIME_DIR_V\d+$/i.test(key))
    .sort((a, b) => Number(b.match(/\d+$/)[0]) - Number(a.match(/\d+$/)[0]))
    .map(key => env[key])
    .filter(directory => directory && path.win32.isAbsolute(directory) &&
      fs.existsSync(path.win32.join(directory, 'Processing.NDI.Lib.x64.dll')));
  if (!directories.length) return load(addonPath);
  const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') || 'PATH';
  const previous = env[pathKey];
  env[pathKey] = [...new Set(directories), previous].filter(Boolean).join(';');
  try { return load(addonPath); }
  finally { if (previous === undefined) delete env[pathKey]; else env[pathKey] = previous; }
}
module.exports = { loadWithNdiRuntime };
