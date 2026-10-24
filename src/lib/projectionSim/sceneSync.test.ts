import { afterEach, describe, expect, it, vi } from 'vitest';

// The Map Sim pop-out and the editor are separate windows with their own
// stores. Two module instances stand in for them here; BroadcastChannel
// carries the scene between them as it does between the windows.
type Instance = { store: typeof import('./store'); stop: () => void };

async function windowInstance(role: 'editor' | 'popout'): Promise<Instance> {
  vi.resetModules();
  const store = await import('./store');
  const { startProjectionSimSceneSync } = await import('./sceneSync');
  return { store, stop: startProjectionSimSceneSync(role) };
}

const sceneOf = (instance: Instance) => {
  let scene: any;
  instance.store.projectionSimScene.subscribe((s) => { scene = s; })();
  return scene;
};

const open: Instance[] = [];
afterEach(() => { while (open.length) open.pop()!.stop(); });

describe('Map Sim scene between the editor and the pop-out', () => {
  it('opens the pop-out on the project scene and brings its edits back to the editor', async () => {
    (globalThis as any).localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
    const editor = await windowInstance('editor'); open.push(editor);
    editor.store.projectionSimScene.newScene();
    const editorScene = sceneOf(editor);

    const popout = await windowInstance('popout'); open.push(popout);
    await vi.waitFor(() => expect(sceneOf(popout).objects.length).toBe(editorScene.objects.length));

    // An edit in the pop-out reaches the editor, which saves the project.
    popout.store.projectionSimScene.loadPreset('cube-pyramid');
    const edited = sceneOf(popout);
    expect(edited.objects.length).toBeGreaterThan(0);
    await vi.waitFor(() => expect(editor.store.projectionSimScene.exportForProject().objects.map((o: any) => o.id))
      .toEqual(edited.objects.map((o: any) => o.id)), { timeout: 2000 });
  });
});
