/**
 * Demo Reel offline renderer — Stage 3D variant of offlineRender.ts.
 *
 * Renders a shot sequence (stage3d/demoReel.ts) into an MP4: per frame
 * it advances the SAME deterministic virtual clock the 2D offline
 * renderer uses (engine manualTime / ISF / stage effects / keyframes /
 * sequencer — so the LED CONTENT animates exactly), plus the Demo
 * Reel's own state: the shot sequence's camera (interpolated move) and
 * the active shot's stage-visuals snapshot (applied on shot entry).
 *
 * Frame capture differs from the 2D pipeline: the deliverable is the
 * STAGE 3D VIEWPORT, which renders to the default framebuffer with
 * preserveDrawingBuffer:false. Stage3DRenderer.captureFrame() reads
 * the framebuffer synchronously right after the scene render — the
 * only reliable window — and hands back top-down RGBA for the same
 * JPEG → FFmpeg → libx264 path.
 *
 * Runs in the Stage 3D pop-out window (the only window that has both
 * the layer engine AND the live Stage3DRenderer).
 */

import { writable, get } from 'svelte/store';
import { loadFFmpeg, formatErr, downloadBlob, thumbnailFromBlob, offlineRender } from './offlineRender';
import { setISFManualTime } from '../isf/renderer';
import { setStageEffectsManualTime } from '../stores/stageEffects';
import { keyframeTimeline } from '../stores/keyframeTimeline';
import { layerSequencer } from '../stores/layerSequencer';
import { mediaLibrary } from '../stores/media';
import { generateUUID } from '../utils/uuid';
import { createAssetRefFromGeneratedBlob } from '../storage/assetRegistry';
import { stage3DRendererControls, stage3dScene } from '../stage3d/store';
import {
  evaluateShotCamera, sequenceDuration, shotAtTime,
  type DemoShot, type DemoReelSettings,
} from '../stage3d/demoReel';

export type ReelRenderStatus =
  | 'idle' | 'loading-ffmpeg' | 'rendering' | 'encoding' | 'saving'
  | 'complete' | 'cancelled' | 'error';

export interface ReelRenderState {
  status: ReelRenderStatus;
  totalFrames: number;
  currentFrame: number;
  encodeProgress: number;
  startedAtMs: number;
  errorMessage: string | null;
  lastOutputUrl: string | null;
  lastOutputName: string | null;
}

const INITIAL: ReelRenderState = {
  status: 'idle',
  totalFrames: 0,
  currentFrame: 0,
  encodeProgress: 0,
  startedAtMs: 0,
  errorMessage: null,
  lastOutputUrl: null,
  lastOutputName: null,
};

function nextFrame(): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

/** RGBA (top-down) → JPEG bytes via a scratch 2D canvas. Same
 *  heap-budget reasoning as the 2D pipeline: raw RGBA would OOM the
 *  ffmpeg wasm FS on any non-trivial reel. */
let scratch: HTMLCanvasElement | null = null;
let scratchCtx: CanvasRenderingContext2D | null = null;
async function rgbaToJpeg(data: Uint8Array, width: number, height: number, quality: number): Promise<Uint8Array> {
  if (!scratch) scratch = document.createElement('canvas');
  if (scratch.width !== width || scratch.height !== height) {
    scratch.width = width;
    scratch.height = height;
    scratchCtx = null;
  }
  if (!scratchCtx) {
    scratchCtx = scratch.getContext('2d', { willReadFrequently: false });
    if (!scratchCtx) throw new Error('scratch 2d context unavailable');
  }
  const clamped = new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
  scratchCtx.putImageData(new ImageData(clamped as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0);
  return new Promise((resolve, reject) => {
    scratch!.toBlob((blob) => {
      if (!blob) { reject(new Error('toBlob returned null')); return; }
      blob.arrayBuffer().then(buf => resolve(new Uint8Array(buf))).catch(reject);
    }, 'image/jpeg', quality);
  });
}

function createReelRenderStore() {
  const { subscribe, update, set } = writable<ReelRenderState>({ ...INITIAL });
  let cancelRequested = false;

  function setStatus(status: ReelRenderStatus, msg?: string) {
    update(s => ({ ...s, status, errorMessage: msg ?? null }));
  }

  async function start(shots: DemoShot[], settings: DemoReelSettings): Promise<boolean> {
    const controls = get(stage3DRendererControls);
    const engineReg = offlineRender.getEngine();
    if (!controls || !engineReg) {
      setStatus('error', 'Stage 3D renderer not ready — open the Stage 3D window first');
      return false;
    }
    if (shots.length === 0) {
      setStatus('error', 'No shots in the sequence');
      return false;
    }
    const { engine, canvas } = engineReg;
    const durationSeconds = sequenceDuration(shots);
    const totalFrames = Math.max(1, Math.round(durationSeconds * settings.fps));
    cancelRequested = false;
    set({ ...INITIAL, status: 'loading-ffmpeg', totalFrames, startedAtMs: performance.now() });

    // Restore points: engine size + manual time + the stage scene the
    // user was looking at (shot snapshots will overwrite it).
    const restoreWidth  = (engine as any).width  ?? canvas.width;
    const restoreHeight = (engine as any).height ?? canvas.height;
    const restoreManual = engine.manualTime;
    const restoreScene = JSON.parse(JSON.stringify(get(stage3dScene)));

    let ffmpeg;
    try {
      ffmpeg = await loadFFmpeg();
    } catch (err) {
      setStatus('error', `FFmpeg load failed: ${formatErr(err)}`);
      return false;
    }
    if (cancelRequested) { setStatus('cancelled'); return false; }

    setStatus('rendering');
    let lastShotIndex = -1;
    try {
      // Resize the engine (and therefore the shared canvas the Stage3D
      // scene renders into) to the reel resolution.
      engine.resize(settings.width, settings.height);
      canvas.width = settings.width;
      canvas.height = settings.height;
      await nextFrame();

      for (let i = 0; i < totalFrames; i++) {
        if (cancelRequested) { setStatus('cancelled'); return false; }
        const virtualTime = i / settings.fps;

        // Content clock — identical to the 2D offline pipeline so LED
        // content (shaders, keyframes, sequencer) animates the same.
        engine.manualTime = virtualTime;
        setISFManualTime(virtualTime);
        setStageEffectsManualTime(virtualTime);
        keyframeTimeline.seek(virtualTime);
        layerSequencer.seek(virtualTime);

        // Shot clock — camera every frame, stage snapshot on entry.
        const at = shotAtTime(shots, virtualTime);
        if (at) {
          if (at.index !== lastShotIndex) {
            lastShotIndex = at.index;
            stage3dScene.loadScene(JSON.parse(JSON.stringify(at.shot.stage)));
          }
          controls.setCameraState(evaluateShotCamera(at.shot, at.progress));
        }

        // One RAF: the live loop renders engine layers + the 3D scene
        // with everything we just set; capture resolves right after the
        // scene render inside that same frame.
        const capturePromise = controls.captureFrame();
        await nextFrame();
        const frame = await capturePromise;

        const jpegBytes = await rgbaToJpeg(frame.data, frame.width, frame.height, 0.92);
        await ffmpeg.writeFile(`frame_${String(i).padStart(6, '0')}.jpg`, jpegBytes);
        update(s => ({ ...s, currentFrame: i + 1 }));
      }

      if (cancelRequested) { setStatus('cancelled'); return false; }

      setStatus('encoding');
      update(s => ({ ...s, encodeProgress: 0 }));
      const onProgress = ({ progress }: { progress: number }) => {
        const p = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
        update(s => ({ ...s, encodeProgress: p }));
      };
      ffmpeg.on('progress', onProgress);
      const crf = settings.quality === 'archive' ? '14' : settings.quality === 'web' ? '23' : '18';
      const outputName = `${settings.filename || 'stage-reel'}.mp4`;
      try {
        await ffmpeg.exec([
          '-framerate', String(settings.fps),
          '-i', 'frame_%06d.jpg',
          '-c:v', 'libx264',
          '-pix_fmt', 'yuv420p',
          '-crf', crf,
          '-preset', settings.quality === 'archive' ? 'slow' : 'medium',
          outputName,
        ]);
      } finally {
        ffmpeg.off('progress', onProgress);
      }
      update(s => ({ ...s, encodeProgress: 1 }));
      if (cancelRequested) { setStatus('cancelled'); return false; }

      setStatus('saving');
      const data = await ffmpeg.readFile(outputName);
      const u8 = data instanceof Uint8Array ? data : new Uint8Array(data as any);
      const blob = new Blob([u8], { type: 'video/mp4' });
      const url = URL.createObjectURL(blob);
      const thumbnail = await thumbnailFromBlob(blob, url, Math.min(2, durationSeconds * 0.4));
      const niceName = `${settings.filename || 'Stage Reel'} ${new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-')}`;
      const { assetRef } = await createAssetRefFromGeneratedBlob(blob, `${niceName}.mp4`, 'video/mp4', url);
      mediaLibrary.addItem({
        id: generateUUID(),
        name: niceName,
        type: 'video',
        src: url,
        thumbnail,
        _assetRef: assetRef,
      });
      downloadBlob(blob, `${niceName}.mp4`);

      try {
        for (let i = 0; i < totalFrames; i++) {
          await ffmpeg.deleteFile(`frame_${String(i).padStart(6, '0')}.jpg`);
        }
        await ffmpeg.deleteFile(outputName);
      } catch { /* best-effort */ }

      update(s => ({ ...s, status: 'complete', lastOutputUrl: url, lastOutputName: niceName }));
      return true;
    } catch (err) {
      console.error('[stageReelRender] error:', err);
      setStatus('error', formatErr(err));
      return false;
    } finally {
      // Hand everything back: camera, content clock, engine size, and
      // the stage scene the user had before the reel ran.
      controls.releaseCamera();
      engine.manualTime = restoreManual;
      setISFManualTime(null);
      setStageEffectsManualTime(null);
      try { stage3dScene.loadScene(restoreScene); } catch { /* keep last shot's scene */ }
      try { engine.resize(restoreWidth, restoreHeight); } catch { /* nothing we can do */ }
    }
  }

  return {
    subscribe,
    start,
    cancel: () => { cancelRequested = true; },
    reset: () => set({ ...INITIAL }),
  };
}

export const stageReelRender = createReelRenderStore();
