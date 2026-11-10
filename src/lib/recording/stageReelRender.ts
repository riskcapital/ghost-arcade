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
  promptSaveMp4,
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
import { showTimeline } from '../stores/showTimeline';
import { mediaLibrary } from '../stores/media';
import { settings as appSettings } from '../stores/settings';
import { generateUUID } from '../utils/uuid';
import { createAssetRefFromGeneratedBlob, pathToFileUrl, type AssetRef } from '../storage/assetRegistry';
import { isElectron } from '../bridge';
import { stage3DRendererControls, stage3dScene } from '../stage3d/store';
import {
  evaluateShotCamera, sequenceDuration, shotAtTime,
  type DemoShot, type DemoReelSettings, type ReelCameraState,
} from '../stage3d/demoReel';
import { borrowStageCamera, holdStageCapture, stageRecordingMaxDim, stageRecordingMirrorDim } from '../show/rehearsal/stageRehearsal';
import type { RecAudioMode, RecAudioResult } from '../show/rehearsal/rehearsalBridge';
import { createLiveFramePacer, streamFramesInFlight } from './liveFramePacing';

/**
 * "Render rehearsal": the reel filmed while the editor PLAYS the show from
 * its start, at the show's length, with the camera on the show's Stage
 * camera lane and the show's soundtrack added afterwards.
 */
export interface ReelRehearsal {
  durationSeconds: number;
  /** Start the show from the top; resolves once it is playing. */
  begin(): Promise<void>;
  /** The camera lane's camera at this instant (epoch ms), or null between shots. */
  cameraAt(epochMs: number): ReelCameraState | null;
  /** The frame due at this instant (epoch ms) was just captured. */
  noteFrame(dueAtEpochMs: number): void;
  /** Add the show's soundtrack to the finished file. */
  addSound(outputPath: string, startedAtEpochMs: number, durationSeconds: number): Promise<RecAudioResult>;
  /** Called once the render is over, whatever happened. */
  end(): void;
}

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
  /** Where the Save dialog copied the reel; null when it was not shown or
   *  was cancelled (the reel is still in the media library). */
  lastSavedPath: string | null;
  /** A rehearsal render: how the show's sound got into the file. */
  lastAudioMode: RecAudioMode | null;
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
  lastSavedPath: null,
  lastAudioMode: null,
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

  async function start(shots: DemoShot[], requestedSettings: DemoReelSettings, rehearsal: ReelRehearsal | null = null): Promise<boolean> {
    // A rehearsal is filmed live into an MP4: the show plays in the editor.
    const settings: DemoReelSettings = rehearsal ? { ...requestedSettings, outputMode: 'mp4' } : requestedSettings;
    const rendererControls = get(stage3DRendererControls);
    const engineReg = offlineRender.getEngine();
    if (!rendererControls || !engineReg) {
      setStatus('error', 'Stage 3D renderer not ready — open the Stage 3D window first');
      return false;
    }
    const controls = rendererControls;
    if (rehearsal && !isElectron) {
      setStatus('error', 'Render rehearsal needs the desktop app');
      return false;
    }
    if (shots.length === 0 && !rehearsal) {
      setStatus('error', 'No shots in the sequence');
      return false;
    }
    const { engine, canvas } = engineReg;
    const durationSeconds = rehearsal ? rehearsal.durationSeconds : sequenceDuration(shots);
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
    // The show's camera lane must not drive the camera under the reel.
    const returnCamera = borrowStageCamera();
    let lastShotIndex = -1;
    const spans = shotTimeline(shots);
    const segmentFrameCount = outputMode === 'frames' || useNativeMp4Encoder
      ? totalFrames
      : getOfflineSegmentFrameCount(settings);
    const segmentNames: string[] = [];
    let currentSegmentFrames = 0;
    let readableOutputName = '';
    let boostedMirror = false;
    // The reel needs the view drawn even if the Stage Sim gets minimised.
    const releaseCaptureHold = holdStageCapture();
    try {
      // Resize the engine (and therefore the shared canvas the Stage3D
      // scene renders into) to the reel resolution.
      engine.resize(settings.width, settings.height);
      canvas.width = settings.width;
      canvas.height = settings.height;
      // Every frame comes from the WebGL stage view (shot camera applied,
      // editor gizmo and outlines left out), the same picture the user
      // sees. The render core's own stage3d scene is not used: it draws
      // the venue as a flat overlay on the core's 2D output, which is also
      // the picture this view maps onto its screens, so the reel came out
      // dim with grey venue shapes and the overlay stayed on the output.
      if (outputMode === 'frames' && frameTarget) {
        nativeJpegSequence = await startNativeJpegSequence(
          frameTarget,
          settings,
          frameBaseName,
          totalFrames,
          'rgba',
        );
      } else if (outputMode === 'mp4' && useNativeMp4Encoder) {
        nativeMp4FrameEncoder = await startNativeMp4FrameEncoder(
          settings,
          totalFrames,
          'rgba',
        );
      }
      await nextFrame();

      // A rehearsal films whatever the show shows, dark moments included;
      // only its first frame is checked for a view that is not drawing.
      let checkedFirstFrame = false;
      async function captureCurrentFrame(): Promise<CapturedFrame> {
        let frame: CapturedFrame | null = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          if (attempt > 0) await nextFrame();
          frame = await controls.captureFrameAt(settings.width, settings.height);
          if (checkedFirstFrame || !frameLooksBlank(frame)) {
            checkedFirstFrame = true;
            return frame;
          }
        }
        throw new Error(`Stage reel captured a black frame (${frame ? frameStats(frame) : 'no frame'}). Make sure the Stage 3D window is open and visible, then try again.`);
      }

      async function captureShotFrame(index: number, shot: DemoShot, progress: number): Promise<CapturedFrame> {
        let shotChanged = false;
        if (index !== lastShotIndex) {
          lastShotIndex = index;
          shotChanged = true;
          stage3dScene.loadScene(JSON.parse(JSON.stringify(shot.stage)));
        }
        // The driven camera is applied at the start of the render that
        // fulfils the capture, so only a new shot's stage needs a frame.
        controls.setCameraState(evaluateShotCamera(shot, progress));
        let frame: CapturedFrame | null = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          if (shotChanged || attempt > 0) await nextFrame();
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

      // Desktop: the stage's screens show the render core's LIVE picture
      // (it runs on its own clock), so the reel is captured in real time —
      // each frame waits for its moment, and when a capture runs late the
      // previous picture holds over the slots it missed. Camera moves and
      // screen content then stay in step, and the file plays at the speed
      // the reel was designed for. Elsewhere the content renders in this
      // window on the virtual clock and the reel renders offline.
      const livePaced = !!(nativeMp4FrameEncoder || nativeJpegSequence);
      // Filming live with a plain cut sequence (or a rehearsal): the stage
      // hands over its renders as it draws them, one per frame slot, read
      // back without stalling it. A cross-dissolve needs two pictures per
      // frame and keeps the frame-by-frame loop below.
      const streamed = livePaced && !!controls.streamFrames && (
        !!rehearsal || (settings.transition ?? 'cut') !== 'cross-dissolve' || spans.length < 2
      );
      if (streamed) {
        // Like Rec: the view draws at 60 and the screens' feed keeps up
        // with the file. Set before the show starts so the feed has settled.
        stageRecordingMaxDim.set(stageRecordingMirrorDim(settings.width));
        boostedMirror = true;
        // The first shot's stage is in place before the clock starts, so
        // frame 0 is not spent loading it.
        const opening = shots.length > 0 ? shotAtTime(shots, 0) : null;
        if (opening) {
          lastShotIndex = opening.index;
          stage3dScene.loadScene(JSON.parse(JSON.stringify(opening.shot.stage)));
          controls.setCameraState(evaluateShotCamera(opening.shot, opening.progress));
          await nextFrame();
          await nextFrame();
        }
      }
      if (rehearsal) {
        if (!livePaced) throw new Error('Render rehearsal needs the desktop MP4 encoder');
        await rehearsal.begin();
      }
      const paceStart = performance.now();
      const paceStartEpoch = performance.timeOrigin + paceStart;
      let lastFrame: CapturedFrame | null = null;
      const writeNativeFrames = async (index: number, frame: CapturedFrame, count: number) => {
        if (nativeMp4FrameEncoder) {
          await writeNativeMp4Frame(nativeMp4FrameEncoder, index, frame, count);
        } else if (nativeJpegSequence) {
          for (let i = 0; i < count; i++) await writeNativeJpegSequenceFrame(nativeJpegSequence, index + i, frame);
        }
      };

      const streamLiveFrames = () => new Promise<void>((resolve, reject) => {
        const pacer = createLiveFramePacer(settings.fps, paceStart);
        const maxInFlight = streamFramesInFlight(settings.width, settings.height, settings.fps);
        let inFlight = 0;
        let ended = false;
        let failed: Error | null = null;
        let settled = false;
        let firstChecked = false;
        let writeChain: Promise<void> = Promise.resolve();
        let stop: () => void = () => {};
        const settle = () => {
          // A failure ends it at once: frames still being read back may
          // never arrive (the stage window closed).
          if (settled || !(ended || failed) || (!failed && inFlight > 0)) return;
          settled = true;
          stop();
          if (failed) reject(failed);
          else resolve();
        };
        const fail = (err: unknown) => {
          failed ??= err instanceof Error ? err : new Error(formatErr(err));
          stop();
          settle();
        };
        stop = controls.streamFrames!(settings.width, settings.height, {
          beforeRender(nowMs) {
            if (failed || ended) return null;
            if (cancelRequested) {
              ended = true;
              queueMicrotask(settle);
              return null;
            }
            if (inFlight >= maxInFlight) return null;
            const slot = pacer.peek(nowMs);
            if (!slot) return null;
            if (slot.first >= totalFrames) {
              ended = true;
              queueMicrotask(settle);
              return null;
            }
            const virtualTime = slot.first / settings.fps;
            engine.manualTime = virtualTime;
            setISFManualTime(virtualTime);
            setStageEffectsManualTime(virtualTime);
            layerSequencer.seek(virtualTime);
            vjLayerSequencer.seek(virtualTime);
            const laneCamera = rehearsal ? rehearsal.cameraAt(performance.timeOrigin + nowMs) : null;
            if (rehearsal && (laneCamera || shots.length === 0)) {
              // The show's camera lane (or, between its shots, the camera as it is).
              if (laneCamera) controls.setCameraState(laneCamera);
              else controls.releaseCamera();
            } else {
              const at = shotAtTime(shots, virtualTime);
              if (at) {
                controls.setCameraState(evaluateShotCamera(at.shot, at.progress));
                if (at.index !== lastShotIndex) {
                  // A new shot's stage lands on the next render: keep that one.
                  lastShotIndex = at.index;
                  stage3dScene.loadScene(JSON.parse(JSON.stringify(at.shot.stage)));
                  return null;
                }
              }
            }
            pacer.commit(slot);
            rehearsal?.noteFrame(paceStartEpoch + (slot.first * 1000) / settings.fps);
            inFlight++;
            return { first: slot.first, repeat: Math.min(slot.repeat, totalFrames - slot.first) };
          },
          frame(captured, tag) {
            const { first, repeat } = tag as { first: number; repeat: number };
            writeChain = writeChain
              .then(async () => {
                if (failed) return;
                let frame: CapturedFrame = captured;
                if (!firstChecked) {
                  // The first frame proves the view is drawing; the one-shot
                  // capture has fallbacks for a canvas that reads back black.
                  firstChecked = true;
                  for (let attempt = 0; attempt < 2 && frameLooksBlank(frame); attempt++) {
                    await nextFrame();
                    frame = await controls.captureFrameAt(settings.width, settings.height);
                  }
                  if (frameLooksBlank(frame)) {
                    throw new Error(`Stage reel captured a black frame (${frameStats(frame)}). Make sure the Stage 3D window is open and visible, then try again.`);
                  }
                }
                await writeNativeFrames(first, frame, repeat);
                update(s => ({ ...s, currentFrame: first + repeat }));
              })
              .catch(fail)
              .finally(() => {
                // Written (or given up): the view may reuse the bytes.
                captured.release?.();
                inFlight--;
                settle();
              });
          },
          error: fail,
        });
      });

      if (streamed) await streamLiveFrames();
      else for (let segmentStart = 0; segmentStart < totalFrames; segmentStart += segmentFrameCount) {
        currentSegmentFrames = Math.min(segmentFrameCount, totalFrames - segmentStart);
        for (let localFrame = 0; localFrame < currentSegmentFrames; localFrame++) {
          if (cancelRequested) { setStatus('cancelled'); return false; }
          let globalFrame = segmentStart + localFrame;
          if (livePaced) {
            const dueAt = paceStart + (globalFrame * 1000) / settings.fps;
            while (performance.now() < dueAt) await nextFrame();
            const nowSlot = Math.min(
              segmentStart + currentSegmentFrames - 1,
              Math.floor(((performance.now() - paceStart) * settings.fps) / 1000),
            );
            if (lastFrame && nowSlot > globalFrame) {
              await writeNativeFrames(globalFrame, lastFrame, nowSlot - globalFrame);
              localFrame += nowSlot - globalFrame;
              globalFrame = nowSlot;
            }
          }
          const virtualTime = globalFrame / settings.fps;

          // Content clock — identical to the 2D offline pipeline so LED
          // content (shaders, keyframes, sequencer) animates the same.
          engine.manualTime = virtualTime;
          setISFManualTime(virtualTime);
          setStageEffectsManualTime(virtualTime);
          layerSequencer.seek(virtualTime);
          vjLayerSequencer.seek(virtualTime);
          if (!livePaced) {
            // Show timeline drives the LED content's preset arrangement too,
            // so a Demo Reel of a programmed show cuts presets where the show
            // does. No-op when the timeline is empty.
            //
            // Not when filming live: the screens show the render core's
            // picture, which the editor's own (playing) show drives. Seeking
            // every frame hard-seeked its audio and video every frame.
            showTimeline.seek(virtualTime);
            // The keyframe tray runs on preset time, not show time: live, each
            // preset's keyframes restart at 0 on its boundary. The preset swap above
            // imports the incoming keyframes a microtask later, so let that land
            // first, then evaluate them at the same instant live playback would.
            await Promise.resolve();
            keyframeTimeline.seek(showTimeline.keyframeTimeFor(virtualTime));
          }

          // Shot clock — camera every frame, stage snapshot on entry.
          let frame: CapturedFrame | null = null;
          const laneCamera = rehearsal ? rehearsal.cameraAt(performance.timeOrigin + performance.now()) : null;
          const transition = !rehearsal && (settings.transition ?? 'cut') === 'cross-dissolve'
            ? transitionAtTime(spans, virtualTime, settings.transitionDurationSec ?? 0.75)
            : null;
          if (rehearsal && (laneCamera || shots.length === 0)) {
            // The show's camera lane (or, between its shots, the camera as it is).
            if (laneCamera) controls.setCameraState(laneCamera);
            else controls.releaseCamera();
            frame = await captureCurrentFrame();
          } else if (transition) {
            const outgoing = await captureShotFrame(transition.prev.index, transition.prev.shot, transition.prevProgress);
            const incoming = await captureShotFrame(transition.next.index, transition.next.shot, transition.nextProgress);
            frame = blendFrames(outgoing, incoming, transition.alpha);
          } else {
            const at = shotAtTime(shots, virtualTime);
            if (at) frame = await captureShotFrame(at.index, at.shot, at.progress);
          }
          if (!frame) throw new Error('Could not capture Stage 3D frame');
          rehearsal?.noteFrame(paceStartEpoch + (globalFrame * 1000) / settings.fps);
          lastFrame = frame;

          if (outputMode === 'frames') {
            if (!frameTarget) throw new Error('Frame export folder not ready');
            if (nativeJpegSequence) {
              await writeNativeFrames(globalFrame, frame, 1);
            } else {
              const jpegBytes = await rgbaToJpeg(frame.data, frame.width, frame.height, 0.92);
              const frameName = `${frameBaseName}_${String(globalFrame).padStart(6, '0')}.jpg`;
              await writeFrameTargetBytes(frameTarget, frameName, jpegBytes);
            }
          } else {
            if (nativeMp4FrameEncoder) {
              await writeNativeFrames(globalFrame, frame, 1);
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
        if (rehearsal) {
          // The show's soundtrack, lined up with the filmed picture.
          const sound = await rehearsal.addSound(encoded.outputPath, paceStartEpoch, durationSeconds);
          if (!sound.ok && sound.error) console.warn('[stageReelRender] rehearsal sound:', sound.error);
          update(s => ({ ...s, lastAudioMode: sound.mode }));
        }

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
        // Same rule as Rec and the main recorder: with the Auto-download
        // recording setting on (the default) ask where to save a copy.
        const savedPath = get(appSettings).recording?.autoDownload
          ? await promptSaveMp4(encoded.outputPath, niceName, 'Save Reel', 'mp4')
          : null;
        update(s => ({
          ...s,
          status: 'complete',
          lastOutputUrl: url,
          lastOutputName: niceName,
          lastOutputKind: 'video',
          lastOutputPath: encoded.outputPath,
          lastSavedPath: savedPath,
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
      if (boostedMirror) stageRecordingMaxDim.set(null);
      releaseCaptureHold();
      controls.releaseCamera();
      returnCamera();
      rehearsal?.end();
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
