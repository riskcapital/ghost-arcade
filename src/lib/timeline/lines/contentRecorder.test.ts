import { describe, expect, it } from 'vitest';
import { createContentRecorder, mediaOfLayer } from './contentRecorder';
import type { Layer, ShowClipMedia, ShowLayerTrack } from '../../types';

const shader = (name: string) => ({ type: 'shader', name, src: `${name}.fs`, shaderCode: `// ${name}\nvoid main(){}`, shaderInputs: [], shaderValues: {} });
const video = (name: string) => ({ type: 'video', name, src: `ghost-asset://localhost/${name}.mp4` });

function rig(opts: { rowHasBlocks?: boolean } = {}) {
  let layers: Layer[] = [
    { id: 'A', name: 'Wall', source: shader('Tide') } as unknown as Layer,
    { id: 'B', name: 'Floor', source: video('rain') } as unknown as Layer,
  ];
  const tracks: ShowLayerTrack[] = [
    { id: 'rowA', layerId: 'A', clips: opts.rowHasBlocks ? [{ id: 'x', startTime: 20, duration: 2 }] : [] } as unknown as ShowLayerTrack,
    { id: 'rowB', layerId: 'B', clips: [] } as unknown as ShowLayerTrack,
  ];
  const written: Array<[string, string, number, number]> = [];
  const swaps: Array<[string, string, number]> = [];
  let armed = true;
  let engine = false;
  const rec = createContentRecorder({
    armed: () => armed,
    layers: () => layers,
    tracks: () => tracks,
    rowFor: (layer) => tracks.find((t) => t.layerId === layer.id)?.id ?? null,
    write: (trackId, media: ShowClipMedia, start, end) => { written.push([trackId, media.name, +start.toFixed(3), +end.toFixed(3)]); },
    notAPerson: () => engine,
    swapAt: (trackId, media: ShowClipMedia, t) => { swaps.push([trackId, media.name, t]); },
  });
  const set = (id: string, source: unknown) => {
    layers = layers.map((l) => (l.id === id ? ({ ...l, source } as Layer) : l));
    rec.observe();
  };
  /** Play from a to b in 0.1 s frames. */
  const play = (a: number, b: number) => { for (let x = a; x <= b + 1e-9; x += 0.1) rec.tick(+x.toFixed(3), true); };
  return { rec, written, swaps, set, play, setArmed: (v: boolean) => { armed = v; }, setEngine: (v: boolean) => { engine = v; } };
}

describe('recording what a piece shows', () => {
  it('a swap while recording becomes a block, and the take before it is kept on an empty row', () => {
    const r = rig();
    r.play(2, 5); // the run starts at 2 s
    r.set('A', shader('Prism'));
    r.play(5, 8);
    r.rec.tick(8, false); // stop
    expect(r.written).toEqual([
      ['rowA', 'Tide', 2, 5],
      ['rowA', 'Prism', 5, 8],
    ]);
  });

  it('on a row that has blocks, only the new content is written', () => {
    const r = rig({ rowHasBlocks: true });
    r.play(0, 3);
    r.set('A', shader('Prism'));
    r.play(3, 6);
    r.rec.stop(6);
    expect(r.written).toEqual([['rowA', 'Prism', 3, 6]]);
  });

  it('settings that change are not content; engines and undo are not recorded', () => {
    const r = rig();
    r.rec.tick(0, true);
    r.rec.tick(1, true);
    r.set('A', { ...shader('Tide'), shaderValues: { speed: 3 } });
    r.setEngine(true);
    r.set('B', video('snow'));
    r.setEngine(false);
    r.rec.tick(4, true);
    r.rec.stop(4);
    expect(r.written).toEqual([]);
  });

  it('nothing is recorded while disarmed or paused', () => {
    const r = rig();
    r.setArmed(false);
    r.rec.tick(1, true);
    r.set('A', shader('Prism'));
    r.rec.tick(3, true);
    r.setArmed(true);
    r.rec.tick(4, false);
    r.set('A', shader('Tide'));
    expect(r.written).toEqual([]);
    expect(r.rec.recording()).toBe(0);
  });

  it('a loop or a seek ends each block where the show was and carries it on', () => {
    const r = rig({ rowHasBlocks: true });
    r.play(0, 1);
    r.set('B', video('snow'));
    r.play(1, 4);
    r.play(0.5, 2); // looped back
    r.rec.stop(2);
    expect(r.written).toEqual([
      ['rowB', 'rain', 0, 1], // the empty row keeps what it showed before
      ['rowB', 'snow', 1, 4],
      ['rowB', 'snow', 0.5, 2],
    ]);
  });

  it('parked (armed, not playing): a swap is cut in at the playhead, nothing is recorded as a take', () => {
    const r = rig();
    r.rec.tick(12, false);
    r.set('B', video('snow'));
    r.setEngine(true);
    r.set('A', shader('Prism'));
    r.setEngine(false);
    expect(r.swaps).toEqual([['rowB', 'snow', 12]]);
    expect(r.written).toEqual([]);
    // Disarmed, a swap is a plain edit.
    r.setArmed(false);
    r.rec.tick(12, false);
    r.set('B', video('rain'));
    expect(r.swaps).toHaveLength(1);
  });

  it('media for blocks comes from shaders, videos, images and sketches only', () => {
    expect(mediaOfLayer({ source: shader('Tide') } as unknown as Layer)?.kind).toBe('shader');
    expect(mediaOfLayer({ source: video('rain') } as unknown as Layer)?.kind).toBe('video');
    expect(mediaOfLayer({ source: { type: 'image', name: 'logo', src: 'logo.png' } } as unknown as Layer)?.kind).toBe('image');
    expect(mediaOfLayer({ source: { type: 'effect', name: 'Studio', effectSource: {} } } as unknown as Layer)).toBeNull();
    expect(mediaOfLayer({ source: null } as unknown as Layer)).toBeNull();
  });
});
