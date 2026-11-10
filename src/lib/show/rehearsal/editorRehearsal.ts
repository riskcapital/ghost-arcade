/**
 * Editor side of rehearsing in the Stage Sim window (see rehearsalBridge.ts).
 *
 * While a stage window says hello, the editor publishes its show transport to
 * it, carries out the transport commands it sends, applies the opt-in
 * audio-sync delay, and puts the show's sound into the stage window's
 * recordings: straight from the song files when the show played through
 * without a jump, otherwise from a live capture of what the editor played.
 */
import { get, writable } from 'svelte/store';
import { showTimeline } from '../../stores/showTimeline';
import { project } from '../../stores/layers';
import { cueList } from '../cueList';
import { liveTakeover, takeoverSummary } from '../takeover/liveTakeover';
import { holdTakeoverForRender, releaseTakeoverRenderHolds } from '../../stores/takeoverFrame';
import { clipAudioBus } from '../../audio/clipAudioBus';
import { invoke } from '../../bridge';
import { showMuxTracks } from '../showAudioExport';
import { muxSidecarAudio, startRecordingAudioSidecar, type AudioSidecar } from '../../recording/recorder';
import {
  REHEARSAL_ALIVE_MS,
  REHEARSAL_CHANNEL,
  REHEARSAL_STATE_HZ,
  clockSkewAllowsExact,
  createClockSkewEstimator,
  epochNow,
  executeRehearsalCommand,
  normalizeAudioDelay,
  planMuxTracks,
  rehearsalArrangementKey,
  rehearsalAudioPlan,
  rehearsalTransportTick,
  type RecAudioResult,
  type RehearsalAudioDelay,
  type RehearsalMessage,
  type RehearsalShowState,
  type RehearsalTransport,
  type TransportSample,
} from './rehearsalBridge';

/** Where older builds saved the audio-sync delay. It is session-only now (a
 *  saved delay ran the house speakers late in a later show with nothing on
 *  screen to say so); the old value is dropped, not applied. */
const LEGACY_AUDIO_DELAY_KEY = 'ghostarcade-stage-audio-delay';

function dropLegacyAudioDelay(): void {
  try {
    globalThis.localStorage?.removeItem(LEGACY_AUDIO_DELAY_KEY);
  } catch {
    /* private mode */
  }
}

/** The speakers' audio-sync delay in force right now (seconds; 0 = none).
 *  The editor shows an indicator whenever it is not 0. */
export const rehearsalAudioDelayActive = writable(0);

interface RecAudioSession {
  id: string;
  samples: TransportSample[];
  sidecar: AudioSidecar | null;
  /** Clock difference measured from this recording's own start message. */
  skewMs: number | null;
  /** The stage page that asked for it. */
  instance: string | null;
}

/** Build the state the stage window mirrors. */
export function buildRehearsalShowState(audioDelay: RehearsalAudioDelay, at = epochNow()): RehearsalShowState {
  const s = get(showTimeline);
  const comps = new Map<string, string>(((get(project) as { compositions?: { id: string; name: string }[] }).compositions ?? []).map((c) => [c.id, c.name]));
  return {
    hasShow: s.duration > 0,
    currentTime: s.currentTime,
    at,
    isPlaying: s.isPlaying,
    duration: s.duration,
    loop: s.loop,
    seekGeneration: showTimeline.seekGeneration(),
    chasing: showTimeline.isChasing(),
    tempo: s.tempo ? JSON.parse(JSON.stringify(s.tempo)) : null,
    hasAudio: s.audioTracks.some((t) => !t.muted && !!t.url && t.volume > 0),
    presets: s.presetClips.map((c) => ({ id: c.id, start: c.startTime, duration: c.duration, label: c.label ?? comps.get(c.compositionId) ?? '' })),
    markers: cueList.state.markers.map((m) => ({ id: m.id, time: m.time, label: m.label })),
    cameraLane: s.cameraLane.map((c) => ({ ...c })),
    audioDelay: { ...audioDelay },
    takeover: (() => {
      const summary = takeoverSummary(liveTakeover.state);
      return summary.active ? summary : null;
    })(),
  };
}

/** The arrangement is rebuilt and compared at least this often, so a change
 *  the inputs below do not show (an edit in place) still reaches the stage. */
const ARRANGEMENT_RECHECK_MS = 1000;

/** What the arrangement is built from. When none of these changed (by
 *  reference: the stores replace what they change), it did not change. */
function arrangementInputs(audioDelay: RehearsalAudioDelay): unknown[] {
  const s = get(showTimeline);
  return [
    s.duration,
    s.loop,
    s.tempo,
    s.audioTracks,
    s.presetClips,
    s.cameraLane,
    (get(project) as { compositions?: unknown }).compositions,
    cueList.state.markers,
    liveTakeover.state,
    audioDelay,
  ];
}

function sameInputs(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
}

/**
 * Publishes the show to the stage window: the whole state when its
 * arrangement changed (or the stage window lacks it), otherwise only the
 * playhead. Calls in one task go out as one message.
 */
export function createRehearsalPublisher(
  post: (msg: RehearsalMessage) => void,
  audioDelay: () => RehearsalAudioDelay,
  now: () => number = epochNow,
) {
  const instance = Math.random().toString(36).slice(2, 8);
  let serial = 0;
  let version = '';
  let lastKey = '';
  let lastInputs: unknown[] = [];
  let lastBuiltAt = -Infinity;
  let sendWhole = true;
  let queued = false;

  const flush = () => {
    queued = false;
    const at = now();
    const delay = audioDelay();
    const inputs = arrangementInputs(delay);
    if (sendWhole || !sameInputs(inputs, lastInputs) || at - lastBuiltAt >= ARRANGEMENT_RECHECK_MS) {
      lastInputs = inputs;
      lastBuiltAt = at;
      const state = buildRehearsalShowState(delay, at);
      const key = rehearsalArrangementKey(state);
      if (key !== lastKey || !version) {
        lastKey = key;
        version = `${instance}.${++serial}`;
        sendWhole = true;
      }
      if (sendWhole) {
        sendWhole = false;
        post({ type: 'show-state', state, version });
        return;
      }
      post({ type: 'show-tick', tick: rehearsalTransportTick(state), version });
      return;
    }
    const s = get(showTimeline);
    post({
      type: 'show-tick',
      tick: { currentTime: s.currentTime, at, isPlaying: s.isPlaying, seekGeneration: showTimeline.seekGeneration(), chasing: showTimeline.isChasing() },
      version,
    });
  };

  return {
    /** Send the transport (and the arrangement if it changed) at the end of this task. */
    publish(): void {
      if (queued) return;
      queued = true;
      queueMicrotask(flush);
    },
    /** The stage window has this arrangement (or none): resend it if it differs. */
    stageHas(stateVersion: string | null | undefined): boolean {
      if (stateVersion && stateVersion === version) return false;
      sendWhole = true;
      return true;
    },
    /** A stage window (re)joined: its first message is the whole state. */
    reset(): void {
      sendWhole = true;
    },
    get version(): string {
      return version;
    },
  };
}

/**
 * Start listening for a Stage Sim window. Returns the uninstall. Cheap while
 * no stage window is open: one channel listener and nothing else.
 */
export function installEditorRehearsal(): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => {};
  const channel = new BroadcastChannel(REHEARSAL_CHANNEL);
  let lastHelloAt = 0;
  let alive = false;
  let publishTimer: ReturnType<typeof setInterval> | null = null;
  dropLegacyAudioDelay();
  let audioDelay = normalizeAudioDelay(null);
  const sessions = new Map<string, RecAudioSession>();
  // How far the stage window's clock is from ours (see finishRecording).
  const skew = createClockSkewEstimator();
  /** The stage page we are talking to (it changes when the window reloads). */
  let stageInstance: string | null = null;

  const post = (msg: RehearsalMessage) => {
    try {
      channel.postMessage(msg);
    } catch (err) {
      console.warn('[Rehearsal] post failed:', err);
    }
  };

  const publisher = createRehearsalPublisher(post, () => audioDelay);
  const publish = () => {
    if (alive) publisher.publish();
  };

  const applyAudioDelay = () => {
    const seconds = alive && audioDelay.enabled ? audioDelay.seconds : 0;
    clipAudioBus.setOutputDelay(seconds);
    rehearsalAudioDelayActive.set(seconds);
  };

  // A Render rehearsal's recording leaves a live takeover out of the
  // picture while it runs (one hold per recording; all go with the window).
  const RENDER_HOLD = 'rehearsal-render:';

  /** Drop every recording's sound capture: the stage window that asked for
   *  them is gone (closed, reloaded, crashed), so no finish will come. */
  const dropSessions = (why: string) => {
    if (sessions.size === 0) return;
    console.info(`[Rehearsal] ${why}: dropping ${sessions.size} recording sound capture(s)`);
    for (const session of sessions.values()) {
      session.sidecar?.discard();
      holdTakeoverForRender(RENDER_HOLD + session.id, false);
    }
    sessions.clear();
  };

  const setAlive = (next: boolean) => {
    if (next === alive) return;
    alive = next;
    if (!alive) releaseTakeoverRenderHolds(RENDER_HOLD);
    if (alive) {
      publisher.reset();
      publishTimer = setInterval(() => {
        if (epochNow() - lastHelloAt > REHEARSAL_ALIVE_MS) setAlive(false);
        else publish();
      }, Math.round(1000 / REHEARSAL_STATE_HZ));
      publish();
    } else {
      if (publishTimer) clearInterval(publishTimer);
      publishTimer = null;
      skew.reset();
      dropSessions('the Stage Sim window went away');
      // Session-only: a delay never outlives the window it lines up with.
      audioDelay = normalizeAudioDelay(null);
    }
    applyAudioDelay();
  };

  const transport: RehearsalTransport = {
    isChasing: () => showTimeline.isChasing(),
    state: () => {
      const s = get(showTimeline);
      return { currentTime: s.currentTime, isPlaying: s.isPlaying, duration: s.duration, loop: s.loop };
    },
    markers: () => cueList.state.markers.map((m) => m.time),
    play: () => showTimeline.play(),
    pause: () => showTimeline.pause(),
    stop: () => showTimeline.stop(),
    seek: (t) => showTimeline.seek(t),
    setLoop: (on) => showTimeline.setLoop(on),
    setAudioDelay: (delay) => {
      audioDelay = delay;
      applyAudioDelay();
    },
    returnTakeover: (instant) => {
      liveTakeover.release('all', instant ? { mode: 'instant' } : undefined);
    },
  };

  const finishRecording = async (msg: Extract<RehearsalMessage, { type: 'rec-audio-finish' }>): Promise<RecAudioResult> => {
    const session = sessions.get(msg.id);
    sessions.delete(msg.id);
    if (!session) return { ok: false, mode: 'none', error: 'No audio was captured for this recording.' };
    let plan = rehearsalAudioPlan(session.samples, msg.startedAt, msg.durationSeconds, msg.latencySeconds);
    // The plan places the song by the two windows' clocks: only trust it
    // when they agree (a clock that went wrong put the wrong part of the
    // song under the picture, minutes off).
    const skewMs = session.skewMs ?? skew.value();
    if (plan.kind === 'exact' && !clockSkewAllowsExact(skewMs)) {
      plan = { kind: 'discontinuous', reason: `the windows' clocks disagree (${skewMs === null ? 'unknown' : `${Math.round(skewMs)} ms`})` };
    }
    if (plan.kind === 'discontinuous') console.info(`[Rehearsal] live sound capture: ${plan.reason}`);
    const s = get(showTimeline);
    if (plan.kind === 'exact') {
      const tracks = planMuxTracks(showMuxTracks(s.audioTracks), plan);
      if (tracks.length > 0) {
        try {
          const result = await invoke<{ success?: boolean; error?: string }>('show_audio_mux', {
            videoPath: msg.videoPath,
            tracks,
            showDuration: msg.durationSeconds,
            renderDuration: msg.durationSeconds,
            loop: false,
          });
          if (result?.success) {
            session.sidecar?.discard();
            return { ok: true, mode: 'exact' };
          }
          console.warn('[Rehearsal] soundtrack mux failed, using the live capture:', result?.error);
        } catch (err) {
          console.warn('[Rehearsal] soundtrack mux failed, using the live capture:', err);
        }
      } else if (!session.sidecar) {
        return { ok: true, mode: 'none' };
      }
    } else if (plan.kind === 'silent' && !session.sidecar) {
      return { ok: true, mode: 'none' };
    }
    if (!session.sidecar) return { ok: false, mode: 'none', error: 'Recording audio is off in Settings.' };
    const muxed = await muxSidecarAudio(msg.videoPath, session.sidecar, false);
    return muxed ? { ok: true, mode: 'sidecar' } : { ok: false, mode: 'none', error: 'The audio could not be added.' };
  };

  channel.onmessage = (event: MessageEvent<RehearsalMessage>) => {
    const msg = event.data;
    if (!msg || typeof msg !== 'object') return;
    switch (msg.type) {
      case 'stage-hello':
        lastHelloAt = epochNow();
        if (msg.instance && msg.instance !== stageInstance) {
          // A reloaded (or new) stage page: what the old one recorded never finishes.
          if (stageInstance) {
            skew.reset();
            for (const [id, session] of sessions) {
              if (session.instance !== msg.instance) {
                session.sidecar?.discard();
                holdTakeoverForRender(RENDER_HOLD + id, false);
                sessions.delete(id);
              }
            }
          }
          stageInstance = msg.instance;
        }
        skew.note(msg.at, lastHelloAt);
        if (!alive) setAlive(true);
        else if (publisher.stageHas(msg.stateVersion)) publish();
        break;
      case 'stage-bye':
        setAlive(false);
        stageInstance = null;
        break;
      case 'show-command': {
        const outcome = executeRehearsalCommand(msg.command, transport);
        if (!outcome.ok && outcome.reason === 'chasing') console.info('[Rehearsal] command refused: timecode owns the show');
        publish();
        break;
      }
      case 'rec-audio-start': {
        if (msg.render) holdTakeoverForRender(RENDER_HOLD + msg.id, true);
        const receivedAt = epochNow();
        skew.note(msg.at, receivedAt);
        const s = get(showTimeline);
        // No show, no show sound: a live capture would only hold the mic.
        const sidecar = s.duration > 0 ? startRecordingAudioSidecar() : null;
        const startSkew = Number.isFinite(msg.at) ? receivedAt - msg.at : null;
        sessions.set(msg.id, {
          id: msg.id,
          sidecar,
          // This message's own transit says the most about this recording;
          // the hellos' best guess covers a slow delivery.
          skewMs: startSkew !== null && clockSkewAllowsExact(startSkew) ? startSkew : skew.value(),
          instance: msg.instance ?? null,
          samples: [{ at: receivedAt, showTime: s.currentTime, playing: s.isPlaying, seekGeneration: showTimeline.seekGeneration() }],
        });
        break;
      }
      case 'rec-audio-cancel': {
        holdTakeoverForRender(RENDER_HOLD + msg.id, false);
        sessions.get(msg.id)?.sidecar?.discard();
        sessions.delete(msg.id);
        break;
      }
      case 'rec-audio-finish':
        holdTakeoverForRender(RENDER_HOLD + msg.id, false);
        void finishRecording(msg).then((result) => {
          console.info(`[Rehearsal] stage recording sound: ${result.mode}${result.error ? ` (${result.error})` : ''}`);
          post({ type: 'rec-audio-result', id: msg.id, result });
        });
        break;
    }
  };

  // Transport events go out at once (a cut must not wait for the 20 Hz
  // publish); every change is logged while a recording wants it. A
  // microtask later, so a play() that sets two states in a row logs the last.
  let lastKey = '';
  let sampleQueued = false;
  const unsubShow = showTimeline.subscribe(() => {
    if (sampleQueued) return;
    sampleQueued = true;
    queueMicrotask(onShowChange);
  });
  function onShowChange(): void {
    sampleQueued = false;
    const s = get(showTimeline);
    const gen = showTimeline.seekGeneration();
    if (sessions.size > 0) {
      const sample: TransportSample = { at: epochNow(), showTime: s.currentTime, playing: s.isPlaying, seekGeneration: gen };
      for (const session of sessions.values()) {
        session.samples.push(sample);
        // An hour at 60 Hz; older samples only matter for the very start.
        if (session.samples.length > 216_000) session.samples.splice(1, 1000);
      }
    }
    const key = `${s.isPlaying}|${gen}|${s.duration}|${s.loop}|${s.cameraLane.length}|${s.presetClips.length}`;
    if (key !== lastKey) {
      lastKey = key;
      publish();
    }
  }
  const unsubCues = cueList.subscribe(() => publish());
  // The stage's LIVE pill and Return follow a takeover at once, not on the
  // next 20 Hz publish. The store changes only on an engage, a release or a
  // phase change (not per fade frame), so this is cheap.
  const unsubTakeover = liveTakeover.subscribe(() => publish());

  return () => {
    unsubShow();
    unsubCues();
    unsubTakeover();
    releaseTakeoverRenderHolds(RENDER_HOLD);
    dropSessions('the editor closed its rehearsal channel');
    if (publishTimer) clearInterval(publishTimer);
    publishTimer = null;
    alive = false;
    applyAudioDelay();
    channel.close();
  };
}
