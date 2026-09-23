import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { expect, it, vi } from 'vitest';

const source = readFileSync('electron/ndi-runtime.cjs', 'utf8');
function harness(files: string[]) {
  const context = { module: { exports: {} as any }, require: (name: string) => name === 'node:path' ? path : { existsSync: (file: string) => files.includes(file) }, process };
  vm.runInNewContext(source, context);
  return context.module.exports.loadWithNdiRuntime;
}
it('loads with the newest installed NDI runtime and restores the original Windows Path', () => {
  const load = harness(['C:\\NDI5\\Processing.NDI.Lib.x64.dll', 'C:\\NDI6\\Processing.NDI.Lib.x64.dll']);
  const env = { Path: 'C:\\Windows', NDI_RUNTIME_DIR_V5: 'C:\\NDI5', NDI_RUNTIME_DIR_V6: 'C:\\NDI6' };
  expect(load('ndi.node', () => { expect(env.Path).toBe('C:\\NDI6;C:\\NDI5;C:\\Windows'); return 'addon'; }, env, 'win32')).toBe('addon');
  expect(env.Path).toBe('C:\\Windows');
});
it('restores Path after a missing runtime dependency fails to load', () => {
  const load = harness(['C:\\NDI6\\Processing.NDI.Lib.x64.dll']);
  const env: Record<string, string> = { NDI_RUNTIME_DIR_V6: 'C:\\NDI6' };
  expect(() => load('ndi.node', () => { throw Error('missing dependency'); }, env, 'win32')).toThrow('missing dependency');
  expect(env.PATH).toBeUndefined();
});
it('ignores missing and relative runtime paths and preserves the Mac loader', () => {
  const load = harness(['relative\\Processing.NDI.Lib.x64.dll']);
  const env = { PATH: 'original', NDI_RUNTIME_DIR_V6: 'relative', NDI_RUNTIME_DIR_V5: 'C:\\missing' };
  const requireAddon = vi.fn(() => { expect(env.PATH).toBe('original'); return {}; });
  load('ndi.node', requireAddon, env, 'win32');
  load('ndi.node', requireAddon, env, 'darwin');
  expect(requireAddon).toHaveBeenCalledTimes(2);
});
