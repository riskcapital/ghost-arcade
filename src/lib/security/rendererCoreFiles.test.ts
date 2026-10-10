import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error The Electron broker is authored as ESM JavaScript; this test exercises it directly.
import { createNativeRendererBroker } from '../../../electron/native-renderer-broker.js';

/**
 * Which files the renderer may hand to the render core.
 *
 * The core reads then deletes the file named in rgba_file / initial_file /
 * data_file / bytes_file, and writes frame exports and recordings to the
 * path it is given. Those fields are how the broker passes its own temp
 * files, so a renderer that set them could have any file read and removed,
 * or any path overwritten. Renderer commands now go through
 * invokeFromRenderer, which drops the fields and checks output paths.
 */

const electronDir = join(process.cwd(), 'electron');
const mainSource = readFileSync(join(electronDir, 'main.js'), 'utf8');

describe('files the renderer may hand to the render core', () => {
  function createBroker(allowedDir: string) {
    const broker = createNativeRendererBroker({
      appRoot: process.cwd(),
      resourcesPath: process.cwd(),
      isPackaged: false,
      platform: process.platform,
      env: { ...process.env, GA_NATIVE_VIDEO_PREFETCH: '0' },
      canWritePath: (target: string) => target.startsWith(allowedDir),
    });
    broker.child = { stdin: { writable: true }, killed: false };
    const sent: Array<{ method: string; params: any }> = [];
    broker.send = async (method: string, params: any) => {
      sent.push({ method, params: JSON.parse(JSON.stringify(params ?? null)) });
      return { ok: true };
    };
    return { broker, sent };
  }

  it('drops a renderer-named file from an upload command', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ga-broker-'));
    const victim = join(dir, 'victim.txt');
    writeFileSync(victim, 'keep me');
    const { broker, sent } = createBroker(dir);
    try {
      await broker.invokeFromRenderer('native_renderer_submit_commands', {
        commands: [{
          type: 'upload_source_frame', source_id: 's', width: 2, height: 2,
          rgba_file: victim, rgba_file_delete: true, rgba_byte_length: 16,
        }],
      });
      await broker.invokeFromRenderer('native_renderer_submit_batch', {
        batch: { commands: [{ type: 'upload_source_frame', source_id: 's', rgba_file: victim, rgba_file_delete: true }] },
      });
      expect(sent).toHaveLength(2);
      for (const { params } of sent) {
        const command = (params.commands ?? params.batch.commands)[0];
        expect(command.rgba_file).toBeUndefined();
        expect(command.rgba_file_delete).toBeUndefined();
        expect(command.source_id).toBe('s');
      }
      expect(JSON.stringify(sent)).not.toContain(victim);
    } finally {
      broker.cleanupTempFrameDir();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('drops renderer-named files from compute graph buffers', async () => {
    const { broker, sent } = createBroker('/nowhere');
    await broker.invokeFromRenderer('native_renderer_run_compute_graph', {
      graph_id: 'g',
      buffers: [
        { id: 'a', initial_file: '/etc/hosts', initial_file_delete: true },
        { id: 'b', data_file: '/etc/hosts', data_file_delete: true },
        { id: 'c', bytes_file: '/etc/hosts', bytes_file_delete: true, byte_length: 8 },
      ],
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].params.buffers).toEqual([{ id: 'a' }, { id: 'b' }, { id: 'c', byte_length: 8 }]);
  });

  it('still hands over its own temp file for pixels the renderer sent', async () => {
    const { broker, sent } = createBroker('/nowhere');
    try {
      await broker.invokeFromRenderer('native_renderer_submit_commands', {
        commands: [{
          type: 'upload_source_frame', source_id: 's', width: 2, height: 2,
          rgba_buffer: Buffer.alloc(16), rgba_file: '/etc/hosts', rgba_file_delete: true,
        }],
      });
      const command = sent[0].params.commands[0];
      expect(command.rgba_file).not.toBe('/etc/hosts');
      expect(command.rgba_file).toContain('ghost-render-core-frames-');
      expect(command.rgba_file_delete).toBe(true);
    } finally { broker.cleanupTempFrameDir(); }
  });

  it('exports frames only to an allowed path', async () => {
    const { broker, sent } = createBroker('/allowed/');
    await expect(broker.invokeFromRenderer('native_renderer_export_frame_snapshot', { path: '/home/user/.zshrc' }))
      .rejects.toThrow(/not an allowed location/);
    // A second spelling must not carry a different target past the check.
    await broker.invokeFromRenderer('native_renderer_export_frame_snapshot', {
      path: '/allowed/frame.raw', file_path: '/home/user/.zshrc', output_path: '/home/user/.zshrc', format: 'raw-texture',
    });
    expect(sent).toEqual([{ method: 'export_frame_snapshot', params: { path: '/allowed/frame.raw', format: 'raw-texture' } }]);
  });

  it('starts a core recording only at an allowed path', async () => {
    const { broker, sent } = createBroker('/allowed/');
    await expect(broker.invokeFromRenderer('native_renderer_start_native_recording', { path: '/home/user/Library/x.mp4', fps: 30 }))
      .rejects.toThrow(/not an allowed location/);
    expect(sent).toHaveLength(0);
    await broker.invokeFromRenderer('native_renderer_start_native_recording', { path: '/allowed/take.mp4', fps: 30 });
    expect(sent).toHaveLength(1);
  });

  it('writes the snapshot JSON only to an allowed path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ga-broker-'));
    const outside = mkdtempSync(join(tmpdir(), 'ga-broker-outside-'));
    const { broker } = createBroker(dir);
    broker.child = null;
    try {
      await expect(broker.invokeFromRenderer('native_renderer_export_snapshot_json', { path: join(outside, 'snap.json') }))
        .rejects.toThrow(/not an allowed location/);
      expect(existsSync(join(outside, 'snap.json'))).toBe(false);
      await broker.invokeFromRenderer('native_renderer_export_snapshot_json', { path: join(dir, 'snap.json') });
      expect(existsSync(join(dir, 'snap.json'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('routes every renderer command through the checked entry point', () => {
    const start = mainSource.indexOf('for (const cmd of nativeRendererCommandNames())');
    expect(start).toBeGreaterThan(-1);
    const loop = mainSource.slice(start, mainSource.indexOf("ipcMain.handle('js_source_open'", start));
    expect(loop).toContain('nativeRendererBroker.invokeFromRenderer(');
    expect(loop).not.toContain('nativeRendererBroker.invoke(');
    expect(mainSource).toContain('canWritePath: target => pathGrants.canWrite(target)');
  });
});
