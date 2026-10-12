import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Which files the renderer may write, copy, and read back.
 *
 * The renderer shows project files that people share. It used to be able to
 * write any absolute path through save_file_text / save_file_binary /
 * save_file_bytes / copy_file_to_project, and read any absolute path through
 * ghost-asset://. Now a path has to come from the user: a native dialog, a
 * file they picked or dropped, a project the main process read, or the
 * app's own asset folder (electron/path-grants.cjs).
 */

const require = createRequire(import.meta.url);
const electronDir = join(process.cwd(), 'electron');
const { createPathGrants } = require(join(electronDir, 'path-grants.cjs'));
const mainSource = readFileSync(join(electronDir, 'main.js'), 'utf8');
const preloadSource = readFileSync(join(electronDir, 'preload.cjs'), 'utf8');

function mainHandler(name: string): string {
  const start = mainSource.indexOf(`ipcMain.handle('${name}'`);
  expect(start, `${name} handler not found`).toBeGreaterThan(-1);
  const next = mainSource.indexOf('ipcMain.handle(', start + 1);
  return mainSource.slice(start, next === -1 ? undefined : next);
}

describe('paths the renderer may write and read', () => {
  const grants = () => createPathGrants({ assetDirs: ['/data/project-assets'], platform: 'linux' });

  it('refuses a path nobody chose', () => {
    const g = grants();
    expect(g.canWrite('/home/user/.zshrc')).toBe(false);
    expect(g.canRead('/home/user/.ssh/id_rsa')).toBe(false);
    expect(g.canWrite('relative/file.txt')).toBe(false);
    expect(g.canWrite('')).toBe(false);
    expect(g.canWrite(undefined)).toBe(false);
  });

  it('allows the app asset folder but not a way out of it', () => {
    const g = grants();
    expect(g.canWrite('/data/project-assets/Recording.mp4')).toBe(true);
    expect(g.canRead('/data/project-assets/Phone Scans/scan.glb')).toBe(true);
    expect(g.canWrite('/data/project-assets/../license.json')).toBe(false);
    expect(g.canWrite('/data/project-assets-other/file.mp4')).toBe(false);
    expect(g.canWrite('/data/remote-pairing.json')).toBe(false);
  });

  it('allows exactly the file named in a save dialog', () => {
    const g = grants();
    g.allowWriteFile('/home/user/Movies/take.mp4');
    expect(g.canWrite('/home/user/Movies/take.mp4')).toBe(true);
    expect(g.canWrite('/home/user/Movies/other.mp4')).toBe(false);
  });

  it('allows files inside a folder picked for export, and nothing beside it', () => {
    const g = grants();
    g.allowWriteDir('/home/user/Export');
    expect(g.canWrite('/home/user/Export/frame_00001.jpg')).toBe(true);
    expect(g.canWrite('/home/user/Export/manifest.json')).toBe(true);
    expect(g.canWrite('/home/user/Exported/frame.jpg')).toBe(false);
    expect(g.canWrite('/home/user/Export/../.zshrc')).toBe(false);
  });

  it('keeps a picked file readable without making it writable', () => {
    const g = grants();
    g.registerPickedFile('/home/user/Videos/clip.mov');
    expect(g.canRead('/home/user/Videos/clip.mov')).toBe(true);
    expect(g.canWrite('/home/user/Videos/clip.mov')).toBe(false);
    expect(g.canRead('/home/user/Videos/other.mov')).toBe(false);
  });

  it('lets a project that was opened be saved back, and its media be read', () => {
    const g = grants();
    const project = JSON.stringify({
      layers: [
        { source: { src: '', _assetRef: { originalPath: '/media/show/loop.mp4' } } },
        { source: { _assetRef: { projectPath: './media/logo.png' } } },
        { source: { src: 'ghost-asset://localhost/media/show/with%20space.webm' } },
        // A forged project naming a secret: not a media file, not readable.
        { source: { _assetRef: { originalPath: '/home/user/.ssh/id_rsa' } } },
        { source: { src: '/home/user/.aws/credentials' } },
      ],
    });
    g.registerProjectFile('/shows/tour/show.gha', project);
    expect(g.canWrite('/shows/tour/show.gha')).toBe(true);
    expect(g.canWrite('/shows/tour/other.gha')).toBe(false);
    expect(g.canRead('/media/show/loop.mp4')).toBe(true);
    expect(g.canRead('/shows/tour/media/logo.png')).toBe(true);
    expect(g.canRead('/media/show/with space.webm')).toBe(true);
    expect(g.canRead('/home/user/.ssh/id_rsa')).toBe(false);
    expect(g.canRead('/home/user/.aws/credentials')).toBe(false);
    expect(g.canWrite('/media/show/loop.mp4')).toBe(false);
  });

  it('compares Windows paths without regard to case or slash direction', () => {
    const g = createPathGrants({ assetDirs: ['C:\\Users\\vj\\AppData\\ga\\project-assets'], platform: 'win32' });
    g.allowWriteDir('D:\\Export');
    expect(g.canWrite('D:\\Export/frame_00001.jpg')).toBe(true);
    expect(g.canWrite('d:/export/frame_00001.jpg')).toBe(true);
    expect(g.canWrite('C:/Users/vj/AppData/ga/project-assets/a.mp4')).toBe(true);
    expect(g.canWrite('D:\\Other\\frame.jpg')).toBe(false);
    expect(g.canWrite('C:\\Windows\\System32\\drivers\\etc\\hosts')).toBe(false);
  });

  it('remembers opened projects and picked media across launches', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ga-path-grants-'));
    try {
      const storePath = join(dir, 'path-grants.json');
      const first = createPathGrants({ storePath, platform: 'linux' });
      first.allowWriteFile('/shows/saved.gha');
      first.allowWriteFile('/home/user/Movies/take.mp4');
      first.registerPickedFile('/home/user/Videos/clip.mov');
      first.flush();
      const second = createPathGrants({ storePath, platform: 'linux' });
      // Recent Files and a recovered autosave come back with these paths.
      expect(second.canWrite('/shows/saved.gha')).toBe(true);
      expect(second.canRead('/home/user/Videos/clip.mov')).toBe(true);
      // A one-off export target is not kept.
      expect(second.canWrite('/home/user/Movies/take.mp4')).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('checks every renderer write and copy against the grants', () => {
    for (const name of ['save_file_text', 'save_file_binary', 'save_file_bytes']) {
      const handler = mainHandler(name);
      expect(handler, name).toContain('pathGrants.canWrite(normalized)');
      expect(handler.indexOf('pathGrants.canWrite('), name).toBeLessThan(handler.indexOf('fs.writeFileSync('));
    }
    const copy = mainHandler('copy_file_to_project');
    expect(copy).toContain('pathGrants.canRead(normSrc)');
    expect(copy).toContain('pathGrants.canWrite(normDest)');
    expect(copy.indexOf('pathGrants.canWrite(')).toBeLessThan(copy.indexOf('fs.copyFileSync('));
  });

  it('grants what the user chose in each native dialog', () => {
    expect(mainHandler('save_project_dialog')).toContain('pathGrants.allowWriteFile(result.filePath)');
    expect(mainHandler('open_project_dialog')).toContain('pathGrants.registerPickedFile(');
    expect(mainHandler('pick_directory')).toContain('pathGrants.allowWriteDir(dirPath)');
    expect(mainHandler('video_converter_pick_output')).toContain('pathGrants.allowWriteFile(');
    expect(mainHandler('read_project_file')).toContain('pathGrants.registerProjectFile(filePath, content)');
  });

  it('serves ghost-asset only for readable paths', () => {
    const start = mainSource.indexOf("protocol.handle('ghost-asset'");
    expect(start).toBeGreaterThan(-1);
    const handler = mainSource.slice(start, mainSource.indexOf('electronNet.fetch(', start));
    expect(handler).toContain('pathGrants.canRead(normalized)');
    expect(handler).toContain('status: 403');
  });

  it('lets only the preload script report a picked file', () => {
    expect(preloadSource).toContain("ipcRenderer.sendSync('path_grant_picked_file', filePath)");
    expect(mainSource).toContain("ipcMain.on('path_grant_picked_file'");
    const allowlist = preloadSource.slice(
      preloadSource.indexOf('const ALLOWED_IPC_COMMANDS'),
      preloadSource.indexOf('contextBridge.exposeInMainWorld'),
    );
    expect(allowlist).not.toContain('path_grant_picked_file');
  });
});
