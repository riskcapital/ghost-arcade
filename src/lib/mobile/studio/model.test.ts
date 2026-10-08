import { describe, it, expect, vi } from 'vitest';
import { MOBILE_SHADERS } from '../standaloneShaderList';
import { standaloneShaderPaths } from './shaderAvailability';
import { loadShow, STORAGE_KEY, defaultShow, normalizeShow, newSurface, movePoint, History, nextBeat, layerGain, mappingRows } from './model';
import { quadPoint, surfaceVertices } from './compositor';
describe('standalone mobile show', () => {
  it('starts with a single deck and crossfades only when dual decks are enabled', () => {
    const s = defaultShow();
    expect(s.dualDeck).toBe(false);
    expect(s.layers[0].clipId).toBeTruthy();
    expect(layerGain(s, 0)).toBe(1);
    expect(layerGain(s, 2)).toBe(1);
    s.dualDeck = true;
    expect(layerGain(s, 4)).toBe(0);
    s.crossfade = 0.5;
    expect(layerGain(s, 0)).toBe(0.5);
    expect(layerGain(s, 4)).toBe(0.5);
  });
  it('normalizes corrupt project values and rejects non-mobile documents', () => {
    expect(() => normalizeShow({ layers: [] })).toThrow();
    const s = defaultShow();
    s.bpm = NaN;
    s.master = 10;
    s.quality = 999 as never;
    s.layers[0].clipId = 'missing';
    s.layers[0].effects = [{ id: 'bad', type: 'unsupported', enabled: true, params: {} }];
    const n = normalizeShow(s);
    expect(n.bpm).toBe(30);
    expect(n.master).toBe(1);
    expect(n.quality).toBe(720);
    expect(n.layers[0].clipId).toBeNull();
    expect(n.layers[0].effects).toEqual([]);
  });
  it('keeps saved media references through a round trip', () => {
    const s = defaultShow();
    s.clips.push({ id: 'local', assetId: 'blob-key', kind: 'video', name: 'Performance.mp4' });
    s.layers[0].clipId = 'local';
    const n = normalizeShow(JSON.parse(JSON.stringify(s)));
    expect(n.layers[0].clipId).toBe('local');
    expect(n.clips.at(-1)?.assetId).toBe('blob-key');
  });
  it('undo and redo capture independent snapshots', () => {
    const s = defaultShow(),
      h = new History();
    h.push(s);
    s.layers[0].opacity = 0.2;
    const prior = h.undo(s)!;
    expect(prior.layers[0].opacity).toBe(1);
    prior.layers[0].opacity = 0.9;
    expect(h.redo(prior)!.layers[0].opacity).toBe(0.2);
  });
  it('quantizes to the next future beat across tempo origins', () => {
    expect(nextBeat(1100, 1000, 120)).toBe(1500);
    expect(nextBeat(1500, 1000, 120)).toBe(2000);
    expect(nextBeat(3000, 1000, 60)).toBe(4000);
  });
});
describe('projection geometry', () => {
  it('projects every corner exactly and preserves rectangular center', () => {
    const p = [
      { x: 0.1, y: 0.2 },
      { x: 0.9, y: 0.2 },
      { x: 0.9, y: 0.8 },
      { x: 0.1, y: 0.8 },
    ];
    expect(quadPoint(p, 0, 0)).toEqual(p[0]);
    expect(quadPoint(p, 1, 1).x).toBeCloseTo(0.9);
    expect(quadPoint(p, 0.5, 0.5).x).toBeCloseTo(0.5);
    expect(quadPoint(p, 0.5, 0.5).y).toBeCloseTo(0.5);
  });
  it('moves content outside the original source rectangle', () => {
    const s = movePoint(newSurface(0), 2, { x: 1.2, y: -0.1 });
    const v = surfaceVertices(s);
    expect(Math.max(...Array.from(v).filter((_, i) => i % 4 === 0))).toBeGreaterThan(1);
    expect(Math.min(...Array.from(v).filter((_, i) => i % 4 === 1))).toBeLessThan(0);
  });
  it('updates corner edge midpoints and preserves an independently edited mesh', () => {
    let s = newSurface(0);
    s = movePoint(s, 0, { x: 0.2, y: 0.3 });
    expect(s.points[1].x).toBeCloseTo((s.points[0].x + s.points[2].x) / 2);
    s.mode = 'mesh';
    const before = JSON.stringify(s.points[1]);
    s = movePoint(s, 4, { x: 0.3, y: 0.7 });
    expect(JSON.stringify(s.points[1])).toBe(before);
    expect(s.points[4]).toEqual({ x: 0.3, y: 0.7 });
    expect(surfaceVertices(s)).toHaveLength(96);
  });
});

it('preserves launcher slots and removes missing clip references on load', () => {
  const show = defaultShow();
  show.launchGrid[2] = [show.clips[0].id, null, 'missing', show.clips[1].id];
  const restored = normalizeShow(JSON.parse(JSON.stringify(show)));
  expect(restored.launchGrid[2]).toEqual([show.clips[0].id, null, null, show.clips[1].id]);
  expect(restored.dualDeck).toBe(false);
});
it('migrates old sets without losing their A/B mix or active clips', () => {
  const old = defaultShow() as any; delete old.launchGrid; delete old.dualDeck;
  old.crossfade = .7;
  const restored = normalizeShow(old);
  expect(restored.dualDeck).toBe(true); expect(restored.crossfade).toBe(.7);
  expect(restored.launchGrid[0]).toContain(old.layers[0].clipId);
});

describe('mobile Looks and deck routing', () => {
 it('migrates layer Looks to mapping screens', () => {
  const s=defaultShow();const look={id:'comet-chase',palette:'fire',enabled:true,amount:.7,speed:1,width:2};
  s.layers[0].look=look;s.surfaces[0].source=0;
  s.scenes=[{id:'scene',name:'Look',layers:s.layers,crossfade:.5,dualDeck:true}];
  const restored=normalizeShow(JSON.parse(JSON.stringify(s)));
  expect(restored.layers[0].look).toBeUndefined();expect(restored.surfaces[0].look).toMatchObject(look);
 });
 it('maps each deck-relative row to both deck sources, including previous deck B assignments', () => {
  expect(mappingRows(0,true)).toEqual([0,4]);expect(mappingRows(1,true)).toEqual([1,5]);expect(mappingRows(2,true)).toEqual([2,6]);expect(mappingRows(3,false)).toEqual([3]);
 });
});

it('preserves independent FX scopes and scene clip settings', () => {
 const s=defaultShow(); const fx=(id:string)=>[{id,type:'invert',enabled:true,params:{mode:1}}];
 s.effects=fx('comp');s.layers[0].effects=fx('layer');s.clips[0].effects=fx('clip');
 s.scenes=[{id:'scene',name:'FX',layers:s.layers,crossfade:0,effects:fx('scene-comp'),clipEffects:{[s.clips[0].id]:fx('scene-clip')}}];
 const restored=normalizeShow(JSON.parse(JSON.stringify(s)));
 expect(restored.effects[0].id).toBe('comp');expect(restored.layers[0].effects[0].id).toBe('layer');expect(restored.clips[0].effects?.[0].id).toBe('clip');
 expect(restored.scenes[0].clipEffects?.[s.clips[0].id][0].id).toBe('scene-clip');
});

it('fills eight demo columns for all eight independent layers and retains crossfade settings',()=>{const s=defaultShow();expect(s.layers).toHaveLength(8);expect(s.launchGrid).toHaveLength(8);for(const row of s.launchGrid){expect(row).toHaveLength(8);expect(row.every(id=>s.clips.some(c=>c.id===id))).toBe(true);}s.crossfadeSettings={transition:'liquid',blend:'screen',curve:'sharp-cut'};expect(normalizeShow(s).crossfadeSettings).toEqual(s.crossfadeSettings);});
it('migrates legacy B rows without changing their clips',()=>{const s=defaultShow();s.dualDeck=true;s.layers=s.layers.slice(0,4);s.layers[2].clipId=s.clips[2].id;s.launchGrid=s.launchGrid.slice(0,4);const n=normalizeShow(s);expect(n.layers[4].clipId).toBe(s.clips[2].id);expect(n.launchGrid[4]).toEqual(s.launchGrid[2]);expect(n.layers[2].clipId).toBeNull();expect(new Set(n.layers.map(l=>l.id)).size).toBe(8);});


it('loads a full playable eight-column deck on first launch and preserves saved empty slots', () => {
  let saved: string | null = null;
  vi.stubGlobal('localStorage', { getItem: (key: string) => key === STORAGE_KEY ? saved : null });
  try {
    const firstLaunch = loadShow();
    expect(firstLaunch.launchGrid).toHaveLength(8);
    expect(firstLaunch.clips).toHaveLength(64);
    for (const row of firstLaunch.launchGrid) {
      expect(row).toHaveLength(8);
      for (const id of row) {
        const clip = firstLaunch.clips.find(c => c.id === id);
        const shader = MOBILE_SHADERS.find(s => s.id === clip?.shaderId);
        expect(shader).toBeDefined();
        expect(shader?.requiresImage).toBeFalsy();
        expect(standaloneShaderPaths.has(shader!.path)).toBe(true);
      }
    }
    firstLaunch.launchGrid[0][0] = null;
    firstLaunch.layers[0].clipId = null;
    saved = JSON.stringify(firstLaunch);
    const reopened = loadShow();
    expect(reopened.id).toBe(firstLaunch.id);
    expect(reopened.launchGrid).toEqual(firstLaunch.launchGrid);
    expect(reopened.layers[0].clipId).toBeNull();
  } finally {
    vi.unstubAllGlobals();
  }
});
