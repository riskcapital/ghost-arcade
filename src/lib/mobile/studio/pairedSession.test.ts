import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultInteractive } from './interactive';
import { pairedSessionFor, recordPairedScene } from './pairedSession';

class TestSocket extends EventTarget {
  readyState = 1;
  send = vi.fn();
  close() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
}

describe('paired interactive session lifetime', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] });
    vi.stubGlobal('WebSocket', { OPEN: 1 });
  });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
  const socket = () => new TestSocket() as unknown as WebSocket & TestSocket;

  it('keeps an active native scene and pause state alive between editors without replaying gestures', () => {
    const ws = socket(), scene = defaultInteractive();
    recordPairedScene(ws, scene, [{ id: 'finger', point: { x: .3, y: .4 }, strength: 1, mode: 'attract' }], true, true, true);
    vi.advanceTimersByTime(3200);
    expect(ws.send).toHaveBeenCalledTimes(4);
    expect(JSON.parse(ws.send.mock.calls.at(-1)![0])).toMatchObject({ type: 'studio_scene', scene, active: true, paused: true, inputs: [] });
    expect(pairedSessionFor(ws)).toMatchObject({ scene, active: true, paused: true });
  });

  it('sends an explicit Stop once and removes its heartbeat', () => {
    const ws = socket(), scene = defaultInteractive();
    recordPairedScene(ws, scene, [], true, false, true);
    recordPairedScene(ws, scene, [], false, false, true);
    recordPairedScene(ws, scene, [], false, false, true);
    vi.advanceTimersByTime(5000);
    expect(ws.send).toHaveBeenCalledTimes(2);
    expect(JSON.parse(ws.send.mock.calls[1][0]).active).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not send an idle draft as a Stop or start native heartbeats for video feeds', () => {
    const ws = socket(), scene = defaultInteractive();
    recordPairedScene(ws, scene, [], false, false, true);
    recordPairedScene(ws, scene, [], true, false, false);
    vi.advanceTimersByTime(5000);
    expect(ws.send).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cleans up on socket close and never carries a live state onto a replacement socket', () => {
    const ws = socket(), scene = defaultInteractive();
    recordPairedScene(ws, scene, [], true, false, true);
    ws.close();
    vi.advanceTimersByTime(5000);
    expect(ws.send).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(pairedSessionFor(socket())).toMatchObject({ scene: null, active: false, native: null });
  });

  it('does not add heartbeat traffic while current editor updates are arriving', () => {
    const ws = socket(), scene = defaultInteractive();
    for (let i = 0; i < 10; i++) { recordPairedScene(ws, scene, [], true, false, true); vi.advanceTimersByTime(500); }
    expect(ws.send).toHaveBeenCalledTimes(10);
    expect(vi.getTimerCount()).toBe(1);
  });
});
