/**
 * Show-control runtime: connects the cue list, timecode chase, scheduler and
 * projectors to the live app. Installed once from App.svelte's onMount.
 *
 * - The cue executor: what each cue action does to the real stores.
 * - `show:*` control paths for MIDI, OSC and keyboard (GO, Back, Stop,
 *   Reset, fire cue N, phrase pads), through the shared router and on to
 *   fireShowAction (showActions.ts), the one action API.
 * - Timeline markers: the playing show timeline fires the cues its markers
 *   name as the playhead crosses them.
 * - The timecode chase sink: drives the show timeline and fires cues that
 *   carry a timecode. MIDI clock and Link follow the show's tempo map.
 * - The playing show drives the launch clock (beat-reactive effects).
 * - The schedule runner, ticking once a second on the wall clock.
 * - Projector status polling while any projector is configured.
 */

import { get } from 'svelte/store';
import { cueList, type CueExecutor, type CueTimelineOp } from './cueList';
import { projectors } from './projectors';
import { timecodeChase } from './timecode/timecodeChase';
import { ScheduleRunner, createScheduleHooks, showSchedule } from './scheduler';
import { onShowControlHydrate } from './showControlPersistence';
import { showTimeline, setShowChaseTransportHandler } from '../stores/showTimeline';
import { installShowLaunchClock } from './sync/showLaunchClock';
import { project } from '../stores/layers';
import { snapshots } from '../stores/snapshots';
import { macros } from '../stores/macros';
import { vjClipLauncher } from '../stores/vjClipLauncher';
import { launchClockTempo, launchClockPosition, launchClockFollowsShow } from '../stores/launchClock';
import { midiRouter, registerShowControl, registerShowInputRelease } from '../midi/midiRouter';
import { runAsLiveControl } from '../stores/historyHooks';
import { handleTakeoverControl, releaseTakeoverInputs, runTakeoverCue, runTakeoverReleaseCue } from './takeover/takeoverRuntime';
import { installSectionRuntime } from '../timeline/sections/sectionRuntime';
import { installPhraseRuntime } from '../timeline/phrases/phraseRuntime';
import { fireShowAction, recallPreset, setBlackout } from './showActions';
import { sampleShowState, showState } from './showState';
import { registerLineSource, registerParamScope } from '../timeline/lines/lineExtensions';
import { lineScopeValues } from '../timeline/lines/lineRuntime';

export { setBlackout } from './showActions';

/** Hooks App.svelte fills in: things only the app shell can do. */
export const showRuntimeHooks: {
  /** Open the outputs fullscreen if they are not already. */
  ensureOutputs: (() => Promise<void> | void) | null;
} = { ensureOutputs: null };

function timeline(op: CueTimelineOp, seconds: number): void {
  // A chased timeline belongs to the timecode source.
  if (showTimeline.isChasing() && op !== 'seek') return;
  switch (op) {
    case 'play': showTimeline.play(); break;
    case 'pause': showTimeline.pause(); break;
    case 'stop': showTimeline.stop(); break;
    case 'seek': showTimeline.seek(seconds); break;
  }
}

export const appCueExecutor: CueExecutor = {
  recallPreset: (compositionId) => { recallPreset(compositionId); },
  recallSnapshot: (slot) => snapshots.recall(slot - 1),
  triggerClip: (deck, layer, column) => vjClipLauncher.triggerClip(layer, column, deck),
  triggerColumn: (deck, column) => vjClipLauncher.triggerColumn(column, deck),
  // Rows a show takeover is showing keep playing until it hands them back.
  stopAllClips: () => vjClipLauncher.stopAllKeepingTakeover(),
  setBlackout,
  readValue(target) {
    if (target.kind === 'macro') {
      return get(macros).macros.find((m) => m.id === `macro-${target.macro}`)?.value ?? null;
    }
    if (target.kind === 'layerOpacity') {
      const layer = get(project).layers.find((l) => l.id === target.layerId);
      return typeof layer?.opacity === 'number' ? layer.opacity : null;
    }
    return null;
  },
  writeValue(target, value) {
    if (target.kind === 'macro') macros.setMacroValue(`macro-${target.macro}`, value);
    else if (target.kind === 'layerOpacity') runAsLiveControl(() => project.updateLayer(target.layerId, { opacity: Math.max(0, Math.min(1, value)) }, { history: false }));
    else midiRouter.dispatchPath(target.path, value, { inputId: `show:${target.path}` });
  },
  timeline,
  projector: (id, command, input) => projectors.command(id, command, input),
  takeover: (action) => runAsLiveControl(() => runTakeoverCue(action)),
  takeoverRelease: (action) => runAsLiveControl(() => runTakeoverReleaseCue(action)),
  bpm: () => {
    try {
      return launchClockTempo();
    } catch {
      return 120;
    }
  },
};

let installed: (() => void) | null = null;
let scheduleRunner: ScheduleRunner | null = null;

export function getScheduleRunner(): ScheduleRunner | null {
  return scheduleRunner;
}

export function installShowControl(): () => void {
  if (installed) return installed;
  const cleanups: Array<() => void> = [];

  cueList.setExecutor(appCueExecutor);
  cleanups.push(() => cueList.setExecutor(null));
  cleanups.push(installSectionRuntime());
  cleanups.push(installPhraseRuntime());

  // ── MIDI / OSC / keyboard ──────────────────────────────────────────
  registerShowControl((action, value = 1, inputId) => {
    // GO: on the Timeline with sections, the sections' (hold, vamp, Live);
    // else the cue list's. The rest of the cue list and the phrase pads go
    // through the same action API; the takeover paths keep their own edge
    // and latch handling.
    if (action === 'go') fireShowAction({ kind: 'go' });
    else if (action === 'back' || action === 'stop' || action === 'reset') fireShowAction({ kind: 'cue', op: action });
    else if ('cue' in action) fireShowAction({ kind: 'cue', op: 'fire', index: action.cue });
    else if ('phrase' in action) fireShowAction(action.phrase === null ? { kind: 'phrase', stop: true } : { kind: 'phrase', pad: action.phrase + 1 });
    else handleTakeoverControl(action, value, inputId);
  });
  cleanups.push(() => registerShowControl(null));
  // A controller that disconnects lets go of the takeovers it holds (with
  // the default release), and only those.
  registerShowInputRelease((prefix) => releaseTakeoverInputs(prefix));
  cleanups.push(() => registerShowInputRelease(null));

  // ── Timeline markers ───────────────────────────────────────────────
  // Markers belong to a document: the active one's fire.
  let prevTime: number | null = null;
  let prevPlaying = false;
  let prevDoc: string | null = null;
  cleanups.push(showTimeline.subscribe((s) => {
    const t = s.currentTime;
    const doc = s.doc ?? 'show';
    if (doc !== prevDoc) {
      prevDoc = doc;
      prevTime = null;
      prevPlaying = false;
    }
    if (s.isPlaying && prevPlaying && prevTime !== null) {
      const delta = t - prevTime;
      if (delta > 0 && delta <= 1) {
        cueList.timelineAdvanced(prevTime, t, null, doc);
      } else if (delta < 0 && s.loop && s.duration > 0 && prevTime - t > s.duration - 1) {
        cueList.timelineAdvanced(prevTime, t, s.duration, doc);
      }
    } else if (s.isPlaying && !prevPlaying) {
      // Transport just started: a marker exactly under the playhead fires.
      cueList.timelineAdvanced(t - 1e-6, t, null, doc);
    }
    prevTime = t;
    prevPlaying = s.isPlaying;
  }));

  // ── Timecode chase ─────────────────────────────────────────────────
  let prevChase: number | null = null;
  let lostHandled = false;
  timecodeChase.setSink((sample, s) => {
    const live = sample.lock === 'locked' || sample.lock === 'freewheel';
    if (live && sample.showTime !== null) {
      lostHandled = false;
      if (s.chaseTimeline) showTimeline.chase(sample.showTime, sample.running, sample.rate);
      if (s.chaseCues && sample.running && prevChase !== null) {
        const d = sample.showTime - prevChase;
        if (d > 0 && d < 1) cueList.timecodeAdvanced(prevChase, sample.showTime);
      }
      prevChase = sample.running ? sample.showTime : null;
    } else {
      prevChase = null;
      if (sample.lock === 'lost' && !lostHandled) {
        lostHandled = true;
        // No last place (it never locked again after a jump): park where the playhead is.
        const at = sample.showTime ?? (showTimeline.isChasing() ? get(showTimeline).currentTime : null);
        if (s.chaseTimeline && at !== null) showTimeline.chase(at, false);
      }
    }
  });
  cleanups.push(() => timecodeChase.setSink(null));
  // MIDI clock and Link need the show's map and playhead.
  timecodeChase.setShowContext(() => {
    const s = get(showTimeline);
    return { map: s.tempo, playhead: s.currentTime, playing: s.isPlaying };
  });
  cleanups.push(() => timecodeChase.setShowContext(null));
  setShowChaseTransportHandler((op) => timecodeChase.transport(op));
  cleanups.push(() => setShowChaseTransportHandler(null));

  // ── Show drives the launch clock ───────────────────────────────────
  cleanups.push(installShowLaunchClock());
  cleanups.push(timecodeChase.settings.subscribe((s) => {
    if (s.source === 'off' || !s.chaseTimeline) showTimeline.releaseChase();
  }));
  cleanups.push(() => timecodeChase.shutdown());

  // ── Scheduler ──────────────────────────────────────────────────────
  const hooks = createScheduleHooks(() => get(showSchedule), {
    cues: cueList,
    projector: (target, command) => projectors.command(target, command),
    setBlackout,
    onStart: () => {
      void showRuntimeHooks.ensureOutputs?.();
    },
  });
  scheduleRunner = new ScheduleRunner(() => get(showSchedule), hooks, () => Date.now());
  const runner = scheduleRunner;
  const scheduleTimer = setInterval(() => runner.tick(), 1000);
  cleanups.push(() => clearInterval(scheduleTimer));
  cleanups.push(onShowControlHydrate(() => runner.reset()));

  // ── Projector polling ──────────────────────────────────────────────
  cleanups.push(projectors.subscribe((s) => {
    const count = s.projectors.filter((p) => p.enabled && p.host).length;
    if (count > 0 && !s.polling) queueMicrotask(() => projectors.startPolling());
    else if (count === 0 && s.polling) queueMicrotask(() => projectors.stopPolling());
  }));
  cleanups.push(() => projectors.stopPolling());

  // Debug/automation surface, same reasoning as window.__ghostArcade.
  try {
    const w = window as unknown as { __ghostArcade?: Record<string, unknown> };
    w.__ghostArcade = {
      ...(w.__ghostArcade ?? {}),
      showControl: { cueList, projectors, timecodeChase, showSchedule, getScheduleRunner, launchClock: { launchClockPosition, launchClockFollowsShow }, midiRouter },
      // The extension points later work plugs into (actions, read-only state, line scopes and sources).
      showSeams: { fireShowAction, showState, sampleShowState, registerParamScope, registerLineSource, lineScopeValues },
    };
  } catch { /* sealed */ }

  installed = () => {
    for (const c of cleanups.reverse()) {
      try { c(); } catch { /* best effort */ }
    }
    scheduleRunner = null;
    installed = null;
  };
  return installed;
}
