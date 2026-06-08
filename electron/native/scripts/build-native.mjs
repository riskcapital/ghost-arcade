import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeDir = path.resolve(__dirname, '..');
const runtimeVersion = process.env.ELECTRON_RUNTIME_VERSION || '42.0.0';
const cmakeJsCli = path.join(nativeDir, 'node_modules', 'cmake-js', 'bin', 'cmake-js');
const mode = process.argv.includes('--rebuild') ? 'rebuild' : 'compile';

function run(command, args, options = {}) {
  console.log(`[native-build] ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: nativeDir,
    stdio: 'inherit',
    shell: false,
    ...options,
  });

  if (result.status !== 0) {
    if (options.allowFailure) {
      console.warn(`[native-build] ${command} failed with exit code ${result.status}; continuing`);
      return;
    }
    process.exit(result.status ?? 1);
  }
}

function buildCmakeJs(verb, arch) {
  const args = [
    cmakeJsCli,
    verb,
    '--runtime=electron',
    `--runtime-version=${runtimeVersion}`,
  ];
  if (arch) args.push(`--arch=${arch}`);
  run(process.execPath, args);
}

if (process.platform !== 'darwin') {
  buildCmakeJs(mode);
  process.exit(0);
}

const outputDir = path.join(nativeDir, 'build', 'Release');
const outputNode = path.join(outputDir, 'syphon_addon.node');
const sliceDir = path.join(nativeDir, '.native-build-slices');
const slices = [
  { cmakeArch: 'x64', lipoArch: 'x86_64' },
  { cmakeArch: 'arm64', lipoArch: 'arm64' },
];

fs.rmSync(sliceDir, { recursive: true, force: true });
fs.mkdirSync(sliceDir, { recursive: true });

for (const slice of slices) {
  buildCmakeJs('rebuild', slice.cmakeArch);
  if (!fs.existsSync(outputNode)) {
    console.error(`[native-build] Expected build output missing: ${outputNode}`);
    process.exit(1);
  }

  const sliceOutput = path.join(sliceDir, `syphon_addon-${slice.lipoArch}.node`);
  fs.copyFileSync(outputNode, sliceOutput);
}

run('lipo', [
  '-create',
  '-output',
  outputNode,
  ...slices.map((slice) => path.join(sliceDir, `syphon_addon-${slice.lipoArch}.node`)),
]);

run('codesign', ['--force', '--sign', '-', outputNode], { allowFailure: true });
run('lipo', ['-info', outputNode]);
fs.rmSync(sliceDir, { recursive: true, force: true });
