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
 * only reliable window — and hands back top-down RGBA. Electron streams
 * those frames directly to native FFmpeg; browser fallback still uses
 * JPEG intermediates before libx264.
 *
 * Runs in the Stage 3D pop-out window (the only window that has both
 * the layer engine AND the live Stage3DRenderer).
 */

import { writable, get } from 'svelte/store';
import {
  loadFFmpeg,
  formatErr,
  downloadBlob,
  thumbnailFromBlob,
  thumbnailFromVideoUrl,
  offlineRender,
  getOfflineSegmentFrameCount,
  encodeOfflineJpegSegment,
  deleteOfflineFrameFiles,
  concatOfflineSegments,
  chooseFrameSequenceTarget,
  writeFrameTargetBytes,
  writeFrameTargetText,
  startNativeJpegSequence,
  writeNativeJpegSequenceFrame,
  finishNativeJpegSequence,
  cancelNativeJpegSequence,
  startNativeMp4FrameEncoder,
  writeNativeMp4Frame,
  writeNativeRendererJpegSequenceFrame,
  writeNativeRendererMp4Frame,
  finishNativeMp4FrameEncoder,
  cancelNativeMp4FrameEncoder,
  frameSequenceManifest,
  frameSequenceBaseName,
  describeFrameTarget,
  type FrameSequenceTarget,
  type NativeJpegSequenceSession,
  type NativeMp4FrameEncoderSession,
} from './offlineRender';
import { setISFManualTime } from '../isf/renderer';
import { setStageEffectsManualTime } from '../stores/stageEffects';
import { keyframeTimeline } from '../stores/keyframeTimeline';
import { layerSequencer } from '../stores/layerSequencer';
import { vjLayerSequencer } from '../stores/vjLayerSequencer';
import { project } from '../stores/layers';
import { mediaLibrary } from '../stores/media';
import { generateUUID } from '../utils/uuid';
import { createAssetRefFromGeneratedBlob, pathToFileUrl, type AssetRef } from '../storage/assetRegistry';
import { isElectron } from '../bridge';
import {
  getNativeRendererCapabilities,
  getNativeRendererStatus,
  setNativeRendererStage3DScene,
  submitNativeRendererCommands,
} from '../api/native-renderer';
import { stage3DRendererControls, stage3dScene } from '../stage3d/store';
import {
  evaluateShotCamera, sequenceDuration, shotAtTime,
  type DemoShot, type DemoReelSettings,
} from '../stage3d/demoReel';
import { buildNativeStage3DScene } from '../stage3d/nativeSceneBridge';

export type ReelRenderStatus =
  | 'idle' | 'choosing-folder' | 'loading-ffmpeg' | 'rendering' | 'encoding' | 'saving'
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
  lastOutputKind: 'video' | 'frames' | null;
  lastOutputPath: string | null;
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
  lastOutputKind: null,
  lastOutputPath: null,
};

function nextFrame(): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

/** Browser fallback only: RGBA (top-down) → JPEG bytes via a scratch
 *  2D canvas. Electron streams raw RGBA directly into native FFmpeg. */
let scratch: HTMLCanvasElement | null = null;
let scratchCtx: CanvasRenderingContext2D | null = null;
type CapturedFrame = { data: Uint8Array; width: number; height: number };
function opaqueRgba(data: Uint8Array): Uint8Array {
  let needsCopy = false;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 255) { needsCopy = true; break; }
  }
  if (!needsCopy) return data;
  const out = new Uint8Array(data);
  for (let i = 3; i < out.length; i += 4) out[i] = 255;
  return out;
}

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
  const opaque = opaqueRgba(data);
  const clamped = new Uint8ClampedArray(opaque.buffer, opaque.byteOffset, opaque.byteLength);
  scratchCtx.putImageData(new ImageData(clamped as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0);
  return new Promise((resolve, reject) => {
    scratch!.toBlob((blob) => {
      if (!blob) { reject(new Error('toBlob returned null')); return; }
      blob.arrayBuffer().then(buf => resolve(new Uint8Array(buf))).catch(reject);
    }, 'image/jpeg', quality);
  });
}

function frameLooksBlank(frame: CapturedFrame): boolean {
  const { data } = frame;
  if (data.length === 0) return true;
  const pixels = data.length >> 2;
  const step = Math.max(1, Math.floor(pixels / 4096));
  let samples = 0;
  let lit = 0;
  for (let p = 0; p < pixels; p += step) {
    const i = p << 2;
    samples++;
    if (data[i] + data[i + 1] + data[i + 2] > 18) lit++;
  }
  return lit <= Math.max(2, samples * 0.002);
}

function frameStats(frame: CapturedFrame): string {
  const { data } = frame;
  const pixels = data.length >> 2;
  const step = Math.max(1, Math.floor(pixels / 4096));
  let samples = 0;
  let max = 0;
  let sum = 0;
  for (let p = 0; p < pixels; p += step) {
    const i = p << 2;
    const rgb = data[i] + data[i + 1] + data[i + 2];
    samples++;
    sum += rgb;
    if (rgb > max) max = rgb;
  }
  const avg = samples > 0 ? sum / samples : 0;
  return `${frame.width}x${frame.height}, avgRGB=${avg.toFixed(1)}, maxRGB=${max}`;
}

function blendFrames(a: CapturedFrame, b: CapturedFrame, amount: number): CapturedFrame {
  if (a.width !== b.width || a.height !== b.height || a.data.length !== b.data.length) {
    return amount < 0.5 ? a : b;
  }
  const t = Math.max(0, Math.min(1, amount));
  const eased = t * t * (3 - 2 * t);
  const inv = 1 - eased;
  const out = new Uint8Array(a.data.length);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = Math.round(a.data[i] * inv + b.data[i] * eased);
    out[i + 1] = Math.round(a.data[i + 1] * inv + b.data[i + 1] * eased);
    out[i + 2] = Math.round(a.data[i + 2] * inv + b.data[i + 2] * eased);
    out[i + 3] = 255;
  }
  return { data: out, width: a.width, height: a.height };
}

function nativePixelFormatForOutput(format: string | null | undefined): 'rgba' | 'bgra' {
  return /bgra/i.test(String(format ?? '')) ? 'bgra' : 'rgba';
}

interface ShotSpan {
  index: number;
  shot: DemoShot;
  start: number;
  duration: number;
}

function shotTimeline(shots: DemoShot[]): ShotSpan[] {
  let t = 0;
  return shots.map((shot, index) => {
    const duration = Math.max(0.1, shot.durationSec);
    const span = { index, shot, start: t, duration };
    t += duration;
    return span;
  });
}

function transitionAtTime(spans: ShotSpan[], t: number, transitionSec: number) {
  const requested = Math.max(0, transitionSec);
  if (requested <= 0 || spans.length < 2) return null;
  for (let i = 1; i < spans.length; i++) {
    const prev = spans[i - 1];
    const next = spans[i];
    const duration = Math.max(0.001, Math.min(requested, prev.duration * 0.85, next.duration * 0.85));
    const start = next.start - duration * 0.5;
    const end = next.start + duration * 0.5;
    if (t < start || t >= end) continue;
    const alpha = (t - start) / duration;
    return {
      prev,
      next,
      alpha,
      prevProgress: Math.max(0, Math.min(1, (t - prev.start) / prev.duration)),
      nextProgress: Math.max(0, Math.min(1, (t - next.start) / next.duration)),
    };
  }
  return null;
}

function createReelRenderStore() {
  const { subscribe, update, set } = writable<ReelRenderState>({ ...INITIAL });
  let cancelRequested = false;

  function setStatus(status: ReelRenderStatus, msg?: string) {
    update(s => ({ ...s, status, errorMessage: msg ?? null }));
  }

  async function start(shots: DemoShot[], settings: DemoReelSettings): Promise<boolean> {
    const rendererControls = get(stage3DRendererControls);
    const engineReg = offlineRender.getEngine();
    if (!rendererControls || !engineReg) {
      setStatus('error', 'Stage 3D renderer not ready — open the Stage 3D window first');
      return false;
    }
    const controls = rendererControls;
    if (shots.length === 0) {
      setStatus('error', 'No shots in the sequence');
      return false;
    }
    const { engine, canvas } = engineReg;
    const durationSeconds = sequenceDuration(shots);
    const totalFrames = Math.max(1, Math.round(durationSeconds * settings.fps));
    const outputMode = settings.outputMode ?? 'mp4';
    const useNativeMp4Encoder = outputMode === 'mp4' && isElectron;
    cancelRequested = false;
    set({
      ...INITIAL,
      status: outputMode === 'frames' ? 'choosing-folder' : (useNativeMp4Encoder ? 'rendering' : 'loading-ffmpeg'),
      totalFrames,
      startedAtMs: performance.now(),
    });

    // Restore points: engine size + manual time + the stage scene the
    // user was looking at (shot snapshots will overwrite it).
    const restoreWidth  = (engine as any).width  ?? canvas.width;
    const restoreHeight = (engine as any).height ?? canvas.height;
    const restoreManual = engine.manualTime;
    const restoreScene = JSON.parse(JSON.stringify(get(stage3dScene)));

    let ffmpeg: Awaited<ReturnType<typeof loadFFmpeg>> | null = null;
    let frameTarget: FrameSequenceTarget | null = null;
    let nativeJpegSequence: NativeJpegSequenceSession | null = null;
    let nativeMp4FrameEncoder: NativeMp4FrameEncoderSession | null = null;
    let nativeJpegSequenceFinished = false;
    let nativeMp4FrameEncoderFinished = false;
    let nativeStageCaptureActive = false;
    let nativeOutputNeedsRestore = false;
    let nativeCapturePixelFormat: 'rgba' | 'bgra' = 'rgba';
    const nativeStageCaptureEligible = isElectron && (settings.transition ?? 'cut') !== 'cross-dissolve';
    const frameBaseName = frameSequenceBaseName(settings.filename, 'stage-reel');
    if (outputMode === 'frames') {
      try {
        frameTarget = await chooseFrameSequenceTarget();
        if (!frameTarget) { setStatus('cancelled'); return false; }
      } catch (err) {
        setStatus('error', formatErr(err));
        return false;
      }
    } else if (!useNativeMp4Encoder) {
      try {
        ffmpeg = await loadFFmpeg();
      } catch (err) {
        setStatus('error', `FFmpeg load failed: ${formatErr(err)}`);
        return false;
      }
    }
    if (cancelRequested) { setStatus('cancelled'); return false; }

    setStatus('rendering');
    let lastShotIndex = -1;
    const spans = shotTimeline(shots);
    const segmentFrameCount = outputMode === 'frames' || useNativeMp4Encoder
      ? totalFrames
      : getOfflineSegmentFrameCount(settings);
    const segmentNames: string[] = [];
    let currentSegmentFrames = 0;
    let readableOutputName = '';
    try {
      // Resize the engine (and therefore the shared canvas the Stage3D
      // scene renders into) to the reel resolution.
      engine.resize(settings.width, settings.height);
      canvas.width = settings.width;
      canvas.height = settings.height;
      if (nativeStageCaptureEligible) {
        try {
          const caps = await getNativeRendererCapabilities();
          const canCaptureNativeStage = !!(
            caps?.core_capabilities_confirmed &&
            caps?.features?.frame_snapshot_export &&
            caps?.features?.native_frame_export &&
            caps?.features?.native_stage3d &&
            caps?.features?.native_stage3d_recording_parity &&
            caps?.implemented_methods?.includes('export_frame_snapshot') &&
            caps?.implemented_methods?.includes('set_stage3d_scene')
          );
          if (canCaptureNativeStage) {
            await submitNativeRendererCommands([
              { type: 'set_output', width: settings.width, height: settings.height, refresh_hz: settings.fps },
            ]);
            nativeOutputNeedsRestore = true;
            const nativeStatus = await getNativeRendererStatus().catch(() => null);
            nativeCapturePixelFormat = nativePixelFormatForOutput(nativeStatus?.output_format);
            nativeStageCaptureActive = true;
          }
        } catch (err) {
          console.warn('[stageReelRender] native Stage3D capture unavailable; using live viewport capture:', err);
          nativeStageCaptureActive = false;
        }
      }
      if (outputMode === 'frames' && frameTarget) {
        nativeJpegSequence = await startNativeJpegSequence(
          frameTarget,
          settings,
          frameBaseName,
          totalFrames,
          nativeStageCaptureActive ? nativeCapturePixelFormat : 'rgba',
        );
        if (nativeStageCaptureActive && !nativeJpegSequence) nativeStageCaptureActive = false;
      } else if (outputMode === 'mp4' && useNativeMp4Encoder) {
        nativeMp4FrameEncoder = await startNativeMp4FrameEncoder(
          settings,
          totalFrames,
          nativeStageCaptureActive ? nativeCapturePixelFormat : 'rgba',
        );
      }
      await nextFrame();
      const nativeSceneLayers = get(project).layers;

      async function captureShotFrame(index: number, shot: DemoShot, progress: number): Promise<CapturedFrame> {
        if (index !== lastShotIndex) {
          lastShotIndex = index;
          stage3dScene.loadScene(JSON.parse(JSON.stringify(shot.stage)));
        }
        controls.setCameraState(evaluateShotCamera(shot, progress));
        let frame: CapturedFrame | null = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          await nextFrame();
          if (controls.captureFrameAt) {
            frame = await controls.captureFrameAt(settings.width, settings.height);
          } else {
            const capturePromise = controls.captureFrame();
            await nextFrame();
            frame = await capturePromise;
          }
          if (!frameLooksBlank(frame)) return frame;
          await nextFrame();
        }
        throw new Error(`Stage reel captured a black frame (${frame ? frameStats(frame) : 'no frame'}). Make sure the Stage 3D window is open and visible, then try again.`);
      }

      for (let segmentStart = 0; segmentStart < totalFrames; segmentStart += segmentFrameCount) {
        currentSegmentFrames = Math.min(segmentFrameCount, totalFrames - segmentStart);
        for (let localFrame = 0; localFrame < currentSegmentFrames; localFrame++) {
          if (cancelRequested) { setStatus('cancelled'); return false; }
          const globalFrame = segmentStart + localFrame;
          const virtualTime = globalFrame / settings.fps;

          // Content clock — identical to the 2D offline pipeline so LED
          // content (shaders, keyframes, sequencer) animates the same.
          engine.manualTime = virtualTime;
          setISFManualTime(virtualTime);
          setStageEffectsManualTime(virtualTime);
          keyframeTimeline.seek(virtualTime);
          layerSequencer.seek(virtualTime);
          vjLayerSequencer.seek(virtualTime);

          if (nativeStageCaptureActive) {
            const at = shotAtTime(shots, virtualTime);
            if (!at) throw new Error('Could not evaluate Stage 3D reel shot for native capture');
            const camera = evaluateShotCamera(at.shot, at.progress);
            await nextFrame();
            await setNativeRendererStage3DScene(
              buildNativeStage3DScene(at.shot.stage, nativeSceneLayers, { camera }),
            );

            if (outputMode === 'frames') {
              if (!nativeJpegSequence) throw new Error('Native Stage 3D frame export folder is not ready');
              await writeNativeRendererJpegSequenceFrame(nativeJpegSequence, globalFrame, virtualTime);
            } else {
              if (!nativeMp4FrameEncoder) throw new Error('Native Stage 3D MP4 encoder is not ready');
              await writeNativeRendererMp4Frame(nativeMp4FrameEncoder, globalFrame, virtualTime);
            }
            update(s => ({ ...s, currentFrame: globalFrame + 1 }));
            continue;
          }

          // Shot clock — camera every frame, stage snapshot on entry.
          let frame: CapturedFrame | null = null;
          const transition = (settings.transition ?? 'cut') === 'cross-dissolve'
            ? transitionAtTime(spans, virtualTime, settings.transitionDurationSec ?? 0.75)
            : null;
          if (transition) {
            const outgoing = await captureShotFrame(transition.prev.index, transition.prev.shot, transition.prevProgress);
            const incoming = await captureShotFrame(transition.next.index, transition.next.shot, transition.nextProgress);
            frame = blendFrames(outgoing, incoming, transition.alpha);
          } else {
            const at = shotAtTime(shots, virtualTime);
            if (at) frame = await captureShotFrame(at.index, at.shot, at.progress);
          }
          if (!frame) throw new Error('Could not capture Stage 3D frame');

          if (outputMode === 'frames') {
            if (!frameTarget) throw new Error('Frame export folder not ready');
            if (nativeJpegSequence) {
              await writeNativeJpegSequenceFrame(nativeJpegSequence, globalFrame, frame);
            } else {
              const jpegBytes = await rgbaToJpeg(frame.data, frame.width, frame.height, 0.92);
              const frameName = `${frameBaseName}_${String(globalFrame).padStart(6, '0')}.jpg`;
              await writeFrameTargetBytes(frameTarget, frameName, jpegBytes);
            }
          } else {
            if (nativeMp4FrameEncoder) {
              await writeNativeMp4Frame(nativeMp4FrameEncoder, globalFrame, frame);
            } else {
              if (!ffmpeg) throw new Error('FFmpeg encoder not ready');
              const jpegBytes = await rgbaToJpeg(frame.data, frame.width, frame.height, 0.92);
              await ffmpeg.writeFile(`frame_${String(localFrame).padStart(6, '0')}.jpg`, jpegBytes);
            }
          }
          update(s => ({ ...s, currentFrame: globalFrame + 1 }));
        }

        if (outputMode === 'frames') {
          currentSegmentFrames = 0;
          continue;
        }

        if (nativeMp4FrameEncoder) {
          currentSegmentFrames = 0;
          continue;
        }

        if (!ffmpeg) throw new Error('FFmpeg encoder not ready');
        setStatus('encoding');
        const segmentIndex = segmentNames.length;
        const segmentName = `stage_segment_${String(segmentIndex).padStart(4, '0')}.mp4`;
        segmentNames.push(segmentName);
        await encodeOfflineJpegSegment(
          ffmpeg,
          currentSegmentFrames,
          settings.fps,
          settings.quality,
          segmentName,
          (progress) => {
            const segmentCount = Math.max(1, Math.ceil(totalFrames / segmentFrameCount));
            const p = (segmentIndex + progress) / segmentCount;
            update(s => ({ ...s, encodeProgress: Math.max(0, Math.min(0.95, p)) }));
          },
        );
        await deleteOfflineFrameFiles(ffmpeg, currentSegmentFrames);
        currentSegmentFrames = 0;
        if (cancelRequested) { setStatus('cancelled'); return false; }
        setStatus('rendering');
      }

      if (cancelRequested) { setStatus('cancelled'); return false; }

      if (outputMode === 'frames') {
        if (!frameTarget) throw new Error('Frame export folder not ready');
        setStatus('saving');
        if (nativeJpegSequence) {
          await finishNativeJpegSequence(nativeJpegSequence);
          nativeJpegSequenceFinished = true;
        }
        const manifestName = `${frameBaseName}_manifest.txt`;
        await writeFrameTargetText(frameTarget, manifestName, frameSequenceManifest({
          baseName: frameBaseName,
          fps: settings.fps,
          width: settings.width,
          height: settings.height,
          totalFrames,
          quality: settings.quality,
        }));
        update(s => ({
          ...s,
          status: 'complete',
          lastOutputName: frameBaseName,
          lastOutputKind: 'frames',
          lastOutputPath: describeFrameTarget(frameTarget!),
        }));
        return true;
      }

      if (nativeMp4FrameEncoder && !nativeMp4FrameEncoderFinished) {
        setStatus('encoding');
        const encoded = await finishNativeMp4FrameEncoder(nativeMp4FrameEncoder);
        nativeMp4FrameEncoderFinished = true;
        update(s => ({ ...s, encodeProgress: 1 }));
        if (cancelRequested) { setStatus('cancelled'); return false; }

        setStatus('saving');
        const url = pathToFileUrl(encoded.outputPath);
        const thumbnail = await thumbnailFromVideoUrl(url, Math.min(2, durationSeconds * 0.4));
        const niceName = `${settings.filename || 'Stage Reel'} ${new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-')}`;
        const assetRef: AssetRef = {
          kind: 'local-file',
          originalPath: encoded.outputPath,
          name: `${niceName}.mp4`,
          mime: 'video/mp4',
          size: encoded.size,
          lastModified: Date.now(),
        };
        mediaLibrary.addItem({
          id: generateUUID(),
          name: niceName,
          type: 'video',
          src: url,
          thumbnail,
          _assetRef: assetRef,
        });
        update(s => ({
          ...s,
          status: 'complete',
          lastOutputUrl: url,
          lastOutputName: niceName,
          lastOutputKind: 'video',
          lastOutputPath: encoded.outputPath,
        }));
        return true;
      }

      if (!ffmpeg) throw new Error('FFmpeg encoder not ready');

      setStatus('encoding');
      readableOutputName = await concatOfflineSegments(ffmpeg, segmentNames, `${settings.filename || 'stage-reel'}.mp4`);
      const outputName = `${settings.filename || 'stage-reel'}.mp4`;
      update(s => ({ ...s, encodeProgress: 1 }));
      if (cancelRequested) { setStatus('cancelled'); return false; }

      setStatus('saving');
      const data = await ffmpeg.readFile(readableOutputName);
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
        if (ffmpeg) {
          await deleteOfflineFrameFiles(ffmpeg, currentSegmentFrames || segmentFrameCount);
          for (const segmentName of segmentNames) await ffmpeg.deleteFile(segmentName);
          if (readableOutputName === outputName) await ffmpeg.deleteFile(outputName);
        }
      } catch { /* best-effort */ }

      update(s => ({ ...s, status: 'complete', lastOutputUrl: url, lastOutputName: niceName, lastOutputKind: 'video' }));
      return true;
    } catch (err) {
      console.error('[stageReelRender] error:', err);
      try {
        if (ffmpeg) {
          await deleteOfflineFrameFiles(ffmpeg, currentSegmentFrames || segmentFrameCount);
          for (const segmentName of segmentNames) await ffmpeg.deleteFile(segmentName);
        }
        if (nativeJpegSequence && !nativeJpegSequenceFinished) {
          await cancelNativeJpegSequence(nativeJpegSequence);
          nativeJpegSequenceFinished = true;
        }
        if (nativeMp4FrameEncoder && !nativeMp4FrameEncoderFinished) {
          await cancelNativeMp4FrameEncoder(nativeMp4FrameEncoder);
          nativeMp4FrameEncoderFinished = true;
        }
      } catch { /* best-effort */ }
      setStatus('error', formatErr(err));
      return false;
    } finally {
      // Hand everything back: camera, content clock, engine size, and
      // the stage scene the user had before the reel ran.
      if (nativeJpegSequence && !nativeJpegSequenceFinished) {
        await cancelNativeJpegSequence(nativeJpegSequence).catch(() => {});
      }
      if (nativeMp4FrameEncoder && !nativeMp4FrameEncoderFinished) {
        await cancelNativeMp4FrameEncoder(nativeMp4FrameEncoder).catch(() => {});
      }
      if (nativeOutputNeedsRestore) {
        await submitNativeRendererCommands([
          { type: 'set_output', width: restoreWidth, height: restoreHeight, refresh_hz: settings.fps },
        ]).catch(() => {});
      }
      controls.releaseCamera();
      engine.manualTime = restoreManual;
      setISFManualTime(null);
      setStageEffectsManualTime(null);
      try { stage3dScene.loadScene(restoreScene); } catch { /* keep last shot's scene */ }
      if (nativeStageCaptureActive || nativeOutputNeedsRestore) {
        await setNativeRendererStage3DScene(
          buildNativeStage3DScene(restoreScene, get(project).layers),
        ).catch(() => {});
      }
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
