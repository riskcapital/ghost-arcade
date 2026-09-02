import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createAssetRefFromFile,
  createDurableAssetRefFromFile,
  hasDurableAssetLocation,
} from './assetRegistry';

/**
 * Drag-and-drop media has to survive a save.
 *
 * webUtils.getPathForFile returns '' for any file that did not come from the
 * OS filesystem — dragged out of a browser window, handed over by a sandboxed
 * app, or any browser build of Ghost Arcade. createAssetRefFromFile turned that
 * empty string into a ref carrying only name/mime/size: no originalPath, no
 * dataUrl, nothing to reload from. The clip then saved with a session blob: URL
 * and reopened dead, which is what "I dropped a file in and my project didn't
 * save it" actually was.
 *
 * These tests drive the three states getPathForFile can leave us in.
 */

const invokeCalls: Array<{ channel: string; args: any }> = [];

function installShims(): void {
  (globalThis as any).URL.createObjectURL ??= () => 'blob:test-object-url';
  (globalThis as any).URL.revokeObjectURL ??= () => {};
  // Node has no FileReader; the data-URL fallback needs one.
  (globalThis as any).FileReader = class {
    result: string | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    readAsDataURL(blob: Blob) {
      void blob.arrayBuffer().then(() => {
        this.result = 'data:application/octet-stream;base64,QUJD';
        this.onload?.();
      });
    }
  };
}

/** @param diskPath what webUtils.getPathForFile hands back ('' = not on disk) */
function setElectron(diskPath: string | null, opts: { canPersist?: boolean } = {}) {
  const api: any = { getPathForFile: () => diskPath };
  if (opts.canPersist) {
    api.invoke = async (channel: string, args: any) => {
      invokeCalls.push({ channel, args });
      return { success: true, path: '/managed/project-assets/dropped.png' };
    };
  }
  (globalThis as any).window = { __ELECTRON__: opts.canPersist === true, electronAPI: api };
}

function droppedFile(): File {
  return new File([new Uint8Array([1, 2, 3])], 'dropped.png', { type: 'image/png' });
}

beforeEach(() => {
  installShims();
  invokeCalls.length = 0;
});

afterEach(() => {
  delete (globalThis as any).window;
});

describe('createDurableAssetRefFromFile', () => {
  it('keeps the disk path and copies nothing when the file is a real OS file', async () => {
    setElectron('/Users/vj/clips/dropped.png', { canPersist: true });
    const { assetRef } = await createDurableAssetRefFromFile(droppedFile());

    expect(assetRef.originalPath).toBe('/Users/vj/clips/dropped.png');
    expect(hasDurableAssetLocation(assetRef)).toBe(true);
    // The fast path must stay free: persisting every dropped video would turn
    // a drag into a multi-gigabyte copy.
    expect(invokeCalls, 'should not have persisted a file that is already on disk').toEqual([]);
  });

  it('persists the bytes when the file has no path on disk', async () => {
    // getPathForFile returns '' for a remote/sandboxed drop, even in Electron.
    setElectron('', { canPersist: true });
    const { assetRef } = await createDurableAssetRefFromFile(droppedFile());

    expect(hasDurableAssetLocation(assetRef), 'ref is still a husk').toBe(true);
    expect(assetRef.originalPath).toBe('/managed/project-assets/dropped.png');
    expect(invokeCalls.map((c) => c.channel)).toEqual(['save_generated_asset']);
  });

  it('falls back to an embedded data URL outside Electron', async () => {
    setElectron('');
    const { assetRef } = await createDurableAssetRefFromFile(droppedFile());

    expect(hasDurableAssetLocation(assetRef)).toBe(true);
    expect(assetRef.dataUrl?.startsWith('data:')).toBe(true);
  });

  it('is the fix: the plain capture leaves an unsaveable husk in that same case', async () => {
    setElectron('');
    const plain = createAssetRefFromFile(droppedFile());

    // Names the regression precisely — this is the state that reached disk.
    expect(plain.assetRef.originalPath).toBeUndefined();
    expect(plain.assetRef.dataUrl).toBeUndefined();
    expect(hasDurableAssetLocation(plain.assetRef)).toBe(false);
  });
});
