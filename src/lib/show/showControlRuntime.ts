/**
 * Show-control runtime: connects the cue list, timecode chase, scheduler and
 * projectors to the live app. Installed once from App.svelte's onMount.
 *
 * - The cue executor: what each cue action does to the real stores.
 * - `show:*` control paths for MIDI, OSC and keyboard (GO, Back, Stop,
 *   Reset, fire cue N), through the shared router.
 * - Timeline markers: the playing show timeline fires the cues its markers
 *   name as the playhead crosses them.
 * - The timecode chase sink: drives the show timeline and fires cues that
 *   carry a timecode.
 * - The schedule runner, ticking once a second on the wall clock.
 * - Projector status polling while any projector is configured.
 */

import { get } from 'svelte/store';
import { cueList, type CueExecutor, type CueTimelineOp } from './cueList';
import { projectors } from './projectors';
import { timecodeChase } from './timecode/timecodeChase';
import { ScheduleRunner, createScheduleHooks, showSchedule } from './scheduler';
import { onShowControlHydrate } from './showControlPersistence';
import { showTimeline } from '../stores/showTimeline';
import { project, compositions } from '../stores/layers';
import { snapshots } from '../stores/snapshots';
import { macros } from '../stores/macros';
import { vjClipLauncher } from '../stores/vjClipLauncher';
import { settings } from '../stores/settings';
import { launchClockTempo } from '../stores/launchClock';
import { midiRouter, registerShowControl } from '../midi/midiRouter';

/** Hooks App.svelte fills in: things only the app shell can do. */
export const showRuntimeHooks: {
  /** Open the outputs fullscreen if they are not already. */
  ensureOutputs: (() => Promise<void> | void) | null;
} = { ensureOutputs: null };

export function setBlackout(on: boolean): void {
  settings.update((s) => (s.output.blackout === on ? s : { ...s, output: { ...s.output, blackout: on } }));
}

/**
 * Recall a mapping preset the way a tray click does (with the tray's
 * transition) when the tray is mounted to take it; otherwise a hard cut.
 */
function recallPreset(compositionId: string): void {
  if (!get(compositions).some((c) => c.id === compositionId)) return;
  const detail = { compositionId, handled: false };
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('show-recall-preset', { detail }));
  if (!detail.handled) project.loadComposition(compositionId);
}

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
  recallPreset,
  recallSnapshot: (slot) => snapshots.recall(slot - 1),
  triggerClip: (deck, layer, column) => vjClipLauncher.triggerClip(layer, column, deck),
  triggerColumn: (deck, column) => vjClipLauncher.triggerColumn(column, deck),
  stopAllClips: () => vjClipLauncher.stopAll(),
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
    else if (target.kind === 'layerOpacity') project.updateLayer(target.layerId, { opacity: Math.max(0, Math.min(1, value)) });
    else midiRouter.dispatchPath(target.path, value, { inputId: `show:${target.path}` });
  },
  timeline,
  projector: (id, command, input) => projectors.command(id, command, input),
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

  // ── MIDI / OSC / keyboard ──────────────────────────────────────────
  registerShowControl((action) => {
    if (action === 'go') cueList.go('remote');
    else if (action === 'back') cueList.back();
    else if (action === 'stop') cueList.stop();
    else if (action === 'reset') cueList.reset();
    else {
      const cue = cueList.state.cues[action.cue];
      if (cue) cueList.fire(cue.id, 'remote');
    }
  });
  cleanups.push(() => registerShowControl(null));

  // ── Timeline markers ───────────────────────────────────────────────
  let prevTime: number | null = null;
  let prevPlaying = false;
  cleanups.push(showTimeline.subscribe((s) => {
    const t = s.currentTime;
    if (s.isPlaying && prevPlaying && prevTime !== null) {
      const delta = t - prevTime;
      if (delta > 0 && delta <= 1) {
        cueList.timelineAdvanced(prevTime, t);
      } else if (delta < 0 && s.loop && s.duration > 0 && prevTime - t > s.duration - 1) {
        cueList.timelineAdvanced(prevTime, t, s.duration);
      }
    } else if (s.isPlaying && !prevPlaying) {
      // Transport just started: a marker exactly under the playhead fires.
      cueList.timelineAdvanced(t - 1e-6, t);
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
      if (s.chaseTimeline) showTimeline.chase(sample.showTime, sample.running);
      if (s.chaseCues && sample.running && prevChase !== null) {
        const d = sample.showTime - prevChase;
        if (d > 0 && d < 1) cueList.timecodeAdvanced(prevChase, sample.showTime);
      }
      prevChase = sample.running ? sample.showTime : null;
    } else {
      prevChase = null;
      if (sample.lock === 'lost' && !lostHandled) {
        lostHandled = true;
        if (s.chaseTimeline && sample.showTime !== null) showTimeline.chase(sample.showTime, false);
      }
    }
  });
  cleanups.push(() => timecodeChase.setSink(null));
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
      showControl: { cueList, projectors, timecodeChase, showSchedule, getScheduleRunner },
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
