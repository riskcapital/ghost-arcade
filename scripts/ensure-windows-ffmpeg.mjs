import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, copyFile, mkdtemp, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const run = promisify(execFile);
const bundle = join(root, 'build-resources', 'ffmpeg', 'win32-x64');
async function sha256(file) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest('hex');
}
export async function verifyWindowsFfmpeg(directory) {
  for (const file of ['ffmpeg.exe', 'LICENSE', 'README.txt', 'provenance.json']) {
    if (!existsSync(join(directory, file))) throw new Error(`Windows FFmpeg bundle is missing ${file}`);
  }
  const { stdout } = await run(join(directory, 'ffmpeg.exe'), ['-hide_banner', '-h', 'encoder=hap'], { windowsHide: true, timeout: 15000 });
  for (const required of ['Encoder hap', 'hap_alpha', 'hap_q', 'snappy']) {
    if (!stdout.includes(required)) throw new Error(`Bundled Windows FFmpeg lacks ${required}`);
  }
}
export async function ensureWindowsFfmpeg({ platform = process.platform, arch = process.arch } = {}) {
  if (platform !== 'win32') return;
  if (arch !== 'x64') throw new Error(`The pinned Windows FFmpeg bundle supports x64, not ${arch}`);
  const pin = JSON.parse(await readFile(join(root, 'build-resources', 'windows-ffmpeg.json'), 'utf8'));
  try {
    const receipt = JSON.parse(await readFile(join(bundle, 'provenance.json'), 'utf8'));
    if (receipt.sha256 === pin.sha256 && receipt.executableSha256 === await sha256(join(bundle, 'ffmpeg.exe'))) {
      await verifyWindowsFfmpeg(bundle);
      console.log('[windows-ffmpeg] verified cached HAP/HAP Alpha/HAP Q encoder');
      return;
    }
  } catch { /* Missing/incomplete cache: provision the pinned archive. */ }
  if (process.argv.includes('--verify')) throw new Error('Windows FFmpeg bundle is missing or invalid. Run npm run windows:ffmpeg.');
  await mkdir(bundle, { recursive: true });
  const temporary = await mkdtemp(join(bundle, '.prepare-'));
  try {
    console.log(`[windows-ffmpeg] downloading ${pin.version} full build`);
    const response = await fetch(pin.url, { signal: AbortSignal.timeout(300000) });
    if (!response.ok || !response.body) throw new Error(`FFmpeg download failed: HTTP ${response.status}`);
    const archive = join(temporary, 'ffmpeg.7z');
    await pipeline(Readable.fromWeb(response.body), createWriteStream(archive));
    if (await sha256(archive) !== pin.sha256) throw new Error('Windows FFmpeg archive SHA-256 mismatch');
    // Windows tar/libarchive reads 7z. Extract only the pinned executable and
    // its notices; ffplay/ffprobe and their duplicate payloads are not shipped.
    await run('tar.exe', ['-xf', archive, '-C', temporary,
      `${pin.archiveRoot}/bin/ffmpeg.exe`, `${pin.archiveRoot}/LICENSE`, `${pin.archiveRoot}/README.txt`], { windowsHide: true, timeout: 180000 });
    const extracted = join(temporary, pin.archiveRoot);
    await copyFile(join(extracted, 'bin', 'ffmpeg.exe'), join(bundle, 'ffmpeg.exe'));
    for (const file of ['LICENSE', 'README.txt']) await copyFile(join(extracted, file), join(bundle, file));
    await writeFile(join(bundle, 'provenance.json'), JSON.stringify({ ...pin, executableSha256: await sha256(join(bundle, 'ffmpeg.exe')) }, null, 2) + '\n');
    await verifyWindowsFfmpeg(bundle);
    console.log(`[windows-ffmpeg] HAP encoder ready: ${bundle}`);
  } finally {
    const owned = relative(bundle, resolve(temporary));
    if (!owned.startsWith('.prepare-') || owned.includes('..') || isAbsolute(owned)) throw new Error('Refusing to remove an unexpected FFmpeg staging path');
    await rm(temporary, { recursive: true, force: true });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await ensureWindowsFfmpeg();
}
