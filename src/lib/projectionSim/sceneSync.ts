/**
 * Keeps the Map Sim scene the same in the editor window and the Map Sim
 * pop-out. The editor owns the project (save, load, the native projector
 * views), so a calibration done in the pop-out has to reach it; and the
 * pop-out has to open on the project's scene, not a preset.
 *
 * Both windows share an origin, so a BroadcastChannel is enough: each
 * window posts its scene after a local edit, and applies scenes posted by
 * the other as remote (no undo step, no echo). The pop-out says hello on
 * start and the editor answers with its scene.
 */
import { projectionSimScene } from './store';
import type { ProjectionSimScene } from './types';

const CHANNEL_NAME = 'ga-projection-sim-scene';
const POST_DELAY_MS = 30;

type SceneSyncMessage =
  | { type: 'hello'; from: string }
  | { type: 'scene'; from: string; scene: ProjectionSimScene };

export function startProjectionSimSceneSync(role: 'editor' | 'popout'): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => {};
  const id = `${role}-${Math.random().toString(36).slice(2, 9)}`;
  const channel = new BroadcastChannel(CHANNEL_NAME);
  let lastSig = '';
  let timer: ReturnType<typeof setTimeout> | null = null;
  let ready = role === 'editor';

  const post = (scene: ProjectionSimScene) => {
    try {
      const sig = JSON.stringify(scene);
      lastSig = sig;
      channel.postMessage({ type: 'scene', from: id, scene: JSON.parse(sig) } satisfies SceneSyncMessage);
    } catch (err) {
      console.warn('[MapSimSceneSync] post failed', err);
    }
  };

  const unsubscribe = projectionSimScene.subscribe((scene) => {
    if (projectionSimScene.isApplyingRemote() || !ready) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (JSON.stringify(scene) !== lastSig) post(scene);
    }, POST_DELAY_MS);
  });

  channel.onmessage = (event: MessageEvent<SceneSyncMessage>) => {
    const message = event.data;
    if (!message || message.from === id) return;
    if (message.type === 'hello') {
      if (role === 'editor') {
        let current: ProjectionSimScene | null = null;
        const unsub = projectionSimScene.subscribe((scene) => { current = scene; });
        unsub();
        if (current) post(current);
      }
      return;
    }
    if (message.type === 'scene' && message.scene?.schemaVersion === 1) {
      const sig = JSON.stringify(message.scene);
      if (sig === lastSig) return;
      lastSig = sig;
      projectionSimScene.applyRemoteScene(message.scene);
      ready = true;
    }
  };

  if (role === 'popout') {
    channel.postMessage({ type: 'hello', from: id } satisfies SceneSyncMessage);
    // With no editor answering (a stand-alone window), start publishing
    // this window's own edits anyway.
    setTimeout(() => { ready = true; }, 1500);
  }

  return () => {
    if (timer) clearTimeout(timer);
    unsubscribe();
    channel.close();
  };
}
