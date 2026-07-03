import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const bin = join(root, 'native-renderer', 'target', 'release', process.platform === 'win32' ? 'ghost-render-core.exe' : 'ghost-render-core');

function check(cmd, args) {
  const result = spawnSync(cmd, args, { encoding: 'utf8' });
  if (result.error) return { ok: false, detail: result.error.message };
  return {
    ok: result.status === 0,
    detail: (result.stdout || result.stderr || '').trim().split('\n')[0] || `exit ${result.status}`,
  };
}

const cargo = check('cargo', ['--version']);
const rustc = check('rustc', ['--version']);
const binary = existsSync(bin);

console.log('Ghost Native Renderer Doctor');
console.log(`cargo: ${cargo.ok ? 'ok' : 'missing'} ${cargo.detail}`);
console.log(`rustc: ${rustc.ok ? 'ok' : 'missing'} ${rustc.detail}`);
console.log(`render-core binary: ${binary ? 'ok' : 'missing'} ${bin}`);

if (!cargo.ok || !rustc.ok || !binary) process.exitCode = 1;
