/**
 * The sound engine lets go of deleted rows and blocks: a deleted row's bus
 * (its effect chain, still connected to the master) and its kick times, and
 * a deleted block's gain, so a long session of edits and project loads does
 * not keep silent effect chains running on the audio thread.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../stores/showTimeline', async () => {
  const { writable } = await import('svelte/store');
  return { showTimeline: writable({}), onShowFrame: () => () => {}, onShowDocChange: () => () => {}, setShowAudioRouter: () => {} };
});
vi.mock('../../ableton/abletonBridge', async () => {
  const { writable } = await import('svelte/store');
  return { abletonBridge: writable({}) };
});
vi.mock('../../audio/showAudio', () => ({ cachedShowAudioDecode: () => null, decodeShowAudio: async () => null }));
vi.mock('../lines/lineRuntime', () => ({ currentLineFrame: () => null }));
vi.mock('../lines/songFeatures', () => ({ songFeaturesFor: async () => null }));
import { FakeAudioContext } from './fakeAudio.testutil';
import { RowBus } from './rowBus';
import { _soundEngineState, pruneSoundGraph } from './soundEngine';
import type { ShowAudioTrack } from '../../types';
import type { SoundRow } from './soundModel';

describe('sound engine pruning', () => {
  it('disposes buses of rows that are gone and disconnects gains of blocks that are gone', () => {
    const ctx = new FakeAudioContext();
    const engine = _soundEngineState() as ReturnType<typeof _soundEngineState> & { buses: Map<string, RowBus> };
    const master = ctx.destination as unknown as AudioNode;
    const busA = new RowBus(ctx as unknown as AudioContext, master);
    const busB = new RowBus(ctx as unknown as AudioContext, master);
    engine.buses.set('a', busA);
    engine.buses.set('b', busB);
    const gain = (rowId: string) => ({ node: ctx.createGain() as unknown as GainNode, rowId, last: 0 });
    const g1 = gain('a'); const g2 = gain('a'); const g3 = gain('b');
    (g1.node as unknown as { connect: (n: unknown) => void }).connect(busA.input);
    (g2.node as unknown as { connect: (n: unknown) => void }).connect(busA.input);
    (g3.node as unknown as { connect: (n: unknown) => void }).connect(busB.input);
    engine.blockGains.set('t1', g1);
    engine.blockGains.set('t2', g2);
    engine.blockGains.set('t3', g3);
    engine.kicks.set('b', { sig: 'x', times: [1] });
    engine.duckedTo.set('b', 3);
    let disposedB = false;
    const dispose = busB.dispose.bind(busB);
    busB.dispose = () => { disposedB = true; dispose(); };

    // Row b deleted, block t2 deleted (same count of blocks as rows: the old size check missed it).
    pruneSoundGraph([{ id: 't1' }, { id: 't3' }] as ShowAudioTrack[], [{ id: 'a' }] as SoundRow[]);

    expect([...engine.buses.keys()]).toEqual(['a']);
    expect(disposedB).toBe(true);
    expect([...engine.blockGains.keys()]).toEqual(['t1']);
    expect((g2.node as unknown as { outputs: Set<unknown> }).outputs.size).toBe(0);
    expect((g3.node as unknown as { outputs: Set<unknown> }).outputs.size).toBe(0);
    expect((g1.node as unknown as { outputs: Set<unknown> }).outputs.size).toBe(1);
    expect(engine.kicks.has('b')).toBe(false);
    expect(engine.duckedTo.has('b')).toBe(false);
    pruneSoundGraph([], []);
    expect(engine.buses.size).toBe(0);
    expect(engine.blockGains.size).toBe(0);
  });
});
