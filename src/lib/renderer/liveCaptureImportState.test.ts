import { readFileSync } from 'node:fs';
import { get } from 'svelte/store';
import { afterEach, describe, expect, it } from 'vitest';
import {
  LIVE_CAPTURE_IMPORT_STATE_MAX,
  forgetLiveCaptureSession,
  liveCaptureImportStates,
  liveCaptureStatusLabel,
  nextLiveCaptureImportState,
  noteLiveCaptureImported,
  noteLiveCaptureRejected,
  noteLiveCaptureSent,
} from './liveCaptureImportState';

afterEach(() => {
  for (const id of [...get(liveCaptureImportStates).keys()]) forgetLiveCaptureSession(id);
});

describe('transitions', () => {
  it('sent -> imported -> rejected -> imported, and repeats are not news', () => {
    expect(nextLiveCaptureImportState(undefined, { type: 'sent' })).toEqual({ state: 'sent' });
    expect(nextLiveCaptureImportState({ state: 'sent' }, { type: 'sent' })).toBeNull();
    expect(nextLiveCaptureImportState({ state: 'sent' }, { type: 'imported' })).toEqual({ state: 'imported' });
    expect(nextLiveCaptureImportState({ state: 'imported' }, { type: 'imported' })).toBeNull();
    // A retry while rejected or imported does not go back to "starting".
    expect(nextLiveCaptureImportState({ state: 'imported' }, { type: 'sent' })).toBeNull();
    expect(nextLiveCaptureImportState({ state: 'rejected', message: 'x' }, { type: 'sent' })).toBeNull();
    expect(nextLiveCaptureImportState({ state: 'imported' }, { type: 'rejected', message: 'x' })).toEqual({ state: 'rejected', message: 'x' });
    expect(nextLiveCaptureImportState({ state: 'rejected', message: 'x' }, { type: 'rejected', message: 'x' })).toBeNull();
    expect(nextLiveCaptureImportState({ state: 'rejected', message: 'x' }, { type: 'rejected', message: 'y' })).toEqual({ state: 'rejected', message: 'y' });
    expect(nextLiveCaptureImportState({ state: 'rejected', message: 'x' }, { type: 'imported' })).toEqual({ state: 'imported' });
    // Rejected before anything was sent (a status that arrives first).
    expect(nextLiveCaptureImportState(undefined, { type: 'imported' })).toEqual({ state: 'imported' });
  });
});

describe('store', () => {
  it('changes only on transitions, not per frame', () => {
    let updates = 0;
    const stop = liveCaptureImportStates.subscribe(() => { updates += 1; });
    const before = updates;
    for (let frame = 0; frame < 120; frame += 1) {
      noteLiveCaptureSent('s1');
      if (frame > 2) noteLiveCaptureImported('s1');
    }
    expect(updates - before).toBe(2);
    expect(get(liveCaptureImportStates).get('s1')).toEqual({ state: 'imported' });
    stop();
  });

  it('forgets a stopped session and is capped', () => {
    for (let i = 0; i < LIVE_CAPTURE_IMPORT_STATE_MAX + 10; i += 1) noteLiveCaptureSent(`s${i}`);
    const map = get(liveCaptureImportStates);
    expect(map.size).toBe(LIVE_CAPTURE_IMPORT_STATE_MAX);
    expect(map.has('s0')).toBe(false);
    expect(map.has(`s${LIVE_CAPTURE_IMPORT_STATE_MAX + 9}`)).toBe(true);
    forgetLiveCaptureSession(`s${LIVE_CAPTURE_IMPORT_STATE_MAX + 9}`);
    expect(get(liveCaptureImportStates).has(`s${LIVE_CAPTURE_IMPORT_STATE_MAX + 9}`)).toBe(false);
  });

  it('carries the notice for a rejected session', () => {
    noteLiveCaptureRejected('s2', 'This camera is on a different graphics chip');
    expect(liveCaptureStatusLabel(get(liveCaptureImportStates).get('s2')))
      .toEqual({ label: 'No picture', tone: 'error', title: 'This camera is on a different graphics chip' });
  });
});

describe('MediaTray label', () => {
  it('Ready before it is used, Starting until the core shows a frame, then Live', () => {
    expect(liveCaptureStatusLabel(undefined)).toMatchObject({ label: 'Ready' });
    expect(liveCaptureStatusLabel({ state: 'sent' })).toMatchObject({ label: 'Starting…', tone: 'connecting' });
    expect(liveCaptureStatusLabel({ state: 'imported' })).toMatchObject({ label: 'Live', tone: 'live' });
  });

  it('MediaTray shows it for native sessions and forgets a stopped one', () => {
    const tray = readFileSync('src/lib/components/MediaTray.svelte', 'utf8');
    expect(tray).toMatch(/liveCaptureStatusLabel\(\$liveCaptureImportStates\.get\(source\.nativeSessionId\)\)/);
    expect(tray).toMatch(/native_live_capture_stop', \{ sessionId: source\.nativeSessionId \}\)[\s\S]{0,200}forgetLiveCaptureSession\(source\.nativeSessionId\)/);
  });
});
