import { describe, expect, it } from 'vitest';
import { jsAnimationFromHtml } from '../renderer/jsAnimationPage';
import { layersPlayingSource, sketchWithCode } from './sketchLayer';

const page = (params: string) => `<html><head><script src="p5.min.js"></script></head><body><script>
window.shaderParams = { ${params} };
function draw() {}
</script></body></html>`;

describe('sketchWithCode', () => {
  const original = { ...jsAnimationFromHtml(page('speed: 1, size: 10')), aiGenerated: true, aiPrompt: 'circles' };
  const moved = { ...original, paramValues: { speed: 2.5, size: 10 } };

  it('keeps slider values the user set when the code around them changes', () => {
    const next = sketchWithCode(moved, page('speed: 1, size: 10').replace('function draw() {}', 'function draw() { circle(1, 1, 1); }'));
    expect(next.paramValues).toEqual({ speed: 2.5, size: 10 });
    expect(next.aiPrompt).toBe('circles');
  });

  it('takes the value from the code when the edit changed it', () => {
    expect(sketchWithCode(moved, page('speed: 3, size: 10')).paramValues).toEqual({ speed: 3, size: 10 });
  });

  it('adds new controls and drops removed ones', () => {
    const next = sketchWithCode(moved, page('speed: 1, hue: 0.5'));
    expect(next.params?.map((p) => p.name)).toEqual(['speed', 'hue']);
    expect(next.paramValues).toEqual({ speed: 2.5, hue: 0.5 });
  });

  it('returns the same source when nothing changed', () => {
    expect(sketchWithCode(moved, moved.htmlCode)).toBe(moved);
  });
});

describe('layersPlayingSource', () => {
  const js = { animationType: 'p5js', htmlCode: '<html></html>' };
  const layers = [
    { id: 'a', source: { id: 'src-1', jsAnimation: js } },
    { id: 'b', source: { id: 'src-2', jsAnimation: js } },
    { id: 'c', source: { id: 'src-1', jsAnimation: js } },
    { id: 'd', source: { id: 'src-1' } },
    { id: 'e', source: null },
  ];

  it('takes the layer opened on first, then the copies that play the same source', () => {
    expect(layersPlayingSource(layers, 'c')).toEqual(['c', 'a']);
    expect(layersPlayingSource(layers, 'b')).toEqual(['b']);
  });

  it('is empty for a layer that holds no sketch', () => {
    expect(layersPlayingSource(layers, 'd')).toEqual([]);
    expect(layersPlayingSource(layers, 'e')).toEqual([]);
    expect(layersPlayingSource(layers, 'missing')).toEqual([]);
  });
});
