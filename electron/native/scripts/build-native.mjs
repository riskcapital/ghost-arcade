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
const syphonNode = path.join(outputDir, 'syphon_addon.node');
const ndiNode = path.join(outputDir, 'ndi_addon.node');
const sliceDir = path.join(nativeDir, '.native-build-slices');
const slices = [
  { cmakeArch: 'x64', lipoArch: 'x86_64' },
  { cmakeArch: 'arm64', lipoArch: 'arm64' },
];

function lipoSlices(outputFile, basename, { required = false } = {}) {
  const sliceFiles = slices.map((slice) => path.join(sliceDir, `${basename}-${slice.lipoArch}${path.extname(outputFile)}`));
  const present = sliceFiles.filter((file) => fs.existsSync(file));
  if (present.length === 0) {
    if (required) {
      console.error(`[native-build] Expected build output missing: ${outputFile}`);
      process.exit(1);
    }
    fs.rmSync(outputFile, { force: true });
    return false;
  }
  if (present.length !== sliceFiles.length) {
    fs.rmSync(outputFile, { force: true });
    console.warn(`[native-build] Skipping universal ${basename}; only found ${present.length}/${sliceFiles.length} slices; removed non-universal output`);
    return false;
  }
  run('lipo', ['-create', '-output', outputFile, ...sliceFiles]);
  run('codesign', ['--force', '--sign', '-', outputFile], { allowFailure: true });
  run('lipo', ['-info', outputFile]);
  return true;
}

fs.rmSync(sliceDir, { recursive: true, force: true });
fs.mkdirSync(sliceDir, { recursive: true });

for (const slice of slices) {
  buildCmakeJs('rebuild', slice.cmakeArch);
  if (!fs.existsSync(syphonNode)) {
    console.error(`[native-build] Expected build output missing: ${syphonNode}`);
    process.exit(1);
  }

  fs.copyFileSync(syphonNode, path.join(sliceDir, `syphon_addon-${slice.lipoArch}.node`));
  if (fs.existsSync(ndiNode)) {
    fs.copyFileSync(ndiNode, path.join(sliceDir, `ndi_addon-${slice.lipoArch}.node`));
  }
}

lipoSlices(syphonNode, 'syphon_addon', { required: true });
lipoSlices(ndiNode, 'ndi_addon');
fs.rmSync(sliceDir, { recursive: true, force: true });
