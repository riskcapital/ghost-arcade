import { spawnSync } from 'node:child_process';

const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const result = spawnSync(
  command,
  ['vitest', 'run', '--config', 'vitest.native.config.ts', 'tests/native/webgpu3DSmoke.native.integration.test.ts'],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      GA_NATIVE_SMOKE3D_INTEGRATION: '1',
    },
  },
);

process.exit(result.status ?? 1);
