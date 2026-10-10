import { describe, expect, it } from 'vitest';
import type { TextContent } from '$lib/types';
import { planTextReader, resolveTextReader, textAtlasSignature, textGlyphPlacements, type TextGlyphMetric } from './textNative';

const base: TextContent = {
  text: 'GHOST ARCADE', fontFamily: 'Inter', fontSize: 100, fontWeight: 700, fontStyle: 'normal',
  color: '#ffffff', strokeColor: '#000000', strokeWidth: 0, alignment: 'center', letterSpacing: 0, lineHeight: 1.2,
  backgroundColor: 'transparent', shadowColor: 'transparent', shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0,
  animation: { type: 'none', speed: 1, loop: true, direction: 'forward', staggerDelay: 0.05, intensity: 1 },
  enable3D: false, extrudeDepth: 0, extrudeColor: '#000000', rotateX: 0, rotateY: 0, rotateZ: 0,
  lightAngle: 0, lightIntensity: 0, bevelSize: 0,
} as TextContent;

// Fixed-width letters, one line, centred: enough to check motion without a font.
function letters(text: string, width = 1920, height = 1080, advance = 60): TextGlyphMetric[] {
  const lines = text.split('\n');
  const out: TextGlyphMetric[] = [];
  let index = 0;
  lines.forEach((line, lineIndex) => {
    const start = (width - line.length * advance) / 2;
    [...line].forEach((char, i) => { out.push({ char, x: start + i * advance, y: height / 2 + lineIndex * 120, width: advance, index: index++, lineIndex }); });
  });
  return out;
}
const withAnim = (type: string, extra: Partial<TextContent> = {}): TextContent => ({ ...base, ...extra, animation: { ...base.animation, type: type as never } });
const span = (p: { x: number; scaleX: number }[], advance = 60) => Math.max(...p.map(d => d.x + advance * d.scaleX)) - Math.min(...p.map(d => d.x));

describe('text motion', () => {
  const l = letters('GHOST ARCADE');

  it('stretches letters wide and pushes their neighbours instead of overlapping them', () => {
    const p = textGlyphPlacements(withAnim('stretchWave'), l, 0.4, 1920, 1080);
    expect(Math.max(...p.map(d => d.scaleX))).toBeGreaterThan(1.8);
    expect(Math.min(...p.map(d => d.scaleX))).toBeGreaterThanOrEqual(1);
    // No letter starts before the one to its left ends (spaces are skipped, so compare in order).
    for (let i = 1; i < p.length; i += 1) expect(p[i].x).toBeGreaterThanOrEqual(p[i - 1].x + 60 * p[i - 1].scaleX - 0.01);
    // The line stays centred while it grows.
    const mid = (Math.min(...p.map(d => d.x)) + Math.max(...p.map(d => d.x + 60 * d.scaleX))) / 2;
    expect(Math.abs(mid - 960)).toBeLessThan(45);
    expect(span(p)).toBeGreaterThan(l.length * 60);
  });

  it('balloons one letter at a time in the elastic style', () => {
    const p = textGlyphPlacements(withAnim('elasticWide'), l, 1.5, 1920, 1080);
    const wide = p.filter(d => d.scaleX > 1.6).length;
    expect(wide).toBeGreaterThanOrEqual(1);
    expect(wide).toBeLessThanOrEqual(4);
  });

  it('grows letters tall from the baseline', () => {
    const p = textGlyphPlacements(withAnim('tallStretch'), l, 0.3, 1920, 1080);
    expect(Math.max(...p.map(d => d.scaleY))).toBeGreaterThan(2.4);
    expect(new Set(p.map(d => Math.round(d.y))).size).toBe(1);
  });

  it('opens and closes the letter spacing', () => {
    const tight = span(textGlyphPlacements(withAnim('trackingBreathe'), l, 0, 1920, 1080));
    const open = span(textGlyphPlacements(withAnim('trackingBreathe'), l, Math.PI / 1.2, 1920, 1080));
    expect(open).toBeGreaterThan(tight * 1.8);
  });

  it('lands words one after another, oversized first', () => {
    const early = textGlyphPlacements(withAnim('slam'), l, 0.1, 1920, 1080);
    expect(early.map(d => d.char).join('')).toBe('GHOST');
    expect(early[0].scaleX).toBeGreaterThan(1.5);
    const settled = textGlyphPlacements(withAnim('slam'), l, 1.2, 1920, 1080);
    expect(settled.map(d => d.char).join('')).toBe('GHOSTARCADE');
    expect(settled.every(d => Math.abs(d.scaleX - 1) < 0.02)).toBe(true);
  });

  it('stacks echoes behind the text with the original on top and solid', () => {
    const p = textGlyphPlacements(withAnim('echoStack'), l, 1, 1920, 1080);
    expect(p.length).toBeGreaterThan(11 * 3);
    const top = p.slice(-11);
    expect(top.every(d => d.alpha === 1)).toBe(true);
    expect(p[0].alpha).toBeLessThan(0.3);
  });

  it('runs the text around a circle', () => {
    const p = textGlyphPlacements(withAnim('orbit'), l, 0, 1920, 1080);
    const radii = p.map(d => Math.hypot(d.x + 30 * Math.cos(d.rotation) - 960, d.y + 30 * Math.sin(d.rotation) - 540));
    expect(Math.max(...radii) - Math.min(...radii)).toBeLessThan(2);
    expect(new Set(p.map(d => d.rotation.toFixed(2))).size).toBe(p.length);
  });

  it('mixes large and small letters along the line', () => {
    const p = textGlyphPlacements(withAnim('sizeCascade'), l, 0.7, 1920, 1080);
    expect(Math.max(...p.map(d => d.scaleY)) / Math.min(...p.map(d => d.scaleY))).toBeGreaterThan(2.5);
  });

  it('never draws a non-finite placement in any new style', () => {
    for (const type of ['stretchWave', 'elasticWide', 'tallStretch', 'trackingBreathe', 'slam', 'drumRoll', 'echoStack', 'riseStagger', 'orbit', 'sizeCascade']) {
      for (const t of [0, 0.37, 2.9, 61.3]) {
        for (const text of ['A', 'GHOST ARCADE', 'TWO\nLINES HERE']) {
          const p = textGlyphPlacements(withAnim(type), letters(text), t, 1920, 1080);
          expect(p.every(d => [d.x, d.y, d.scaleX, d.scaleY, d.rotation, d.alpha].every(Number.isFinite)), `${type} ${t} ${text}`).toBe(true);
        }
      }
    }
  });
});

describe('long text reader', () => {
  const story = 'It was a bright cold day in April, and the clocks were striking thirteen. Winston Smith slipped quickly through the glass doors. The hallway smelt of boiled cabbage and old rag mats.';
  const reading = (unit: string, extra = {}): TextContent => ({ ...base, text: story, reader: { enabled: true, unit: unit as never, wordsPerMinute: 240, wordsPerPhrase: 4, loop: true, ...extra } });

  it('is off unless asked for', () => {
    expect(resolveTextReader({ ...base, text: story }, 1920, 1080, 3)).toBeNull();
  });

  it('shows one word at a time, in order, at the chosen pace', () => {
    const words = story.split(/\s+/);
    const seen: string[] = [];
    const plan = planTextReader(reading('word'), 1920, 1080);
    expect(plan.chunks).toEqual(words);
    for (let i = 0; i < plan.chunks.length; i += 1) {
      const at = (i > 0 ? plan.ends[i - 1] : 0) + 0.01;
      seen.push(resolveTextReader(reading('word'), 1920, 1080, at)!.text);
    }
    expect(seen).toEqual(words);
    // 240 words a minute is a quarter second a word, plus a breath after each sentence.
    expect(plan.total).toBeGreaterThan(words.length * 0.25);
    expect(plan.total).toBeLessThan(words.length * 0.25 + 3 * 0.35 + words.length * 0.05);
  });

  it('breaks phrases at sentence ends and never loses or repeats a word', () => {
    const plan = planTextReader(reading('phrase'), 1920, 1080);
    expect(plan.chunks.join(' ').replace(/\n/g, ' ')).toBe(story);
    expect(plan.chunks.every(c => c.replace(/\n/g, ' ').split(' ').length <= 4)).toBe(true);
    expect(plan.chunks.some(c => c.endsWith('thirteen.'))).toBe(true);
  });

  it('restarts the clock for each piece so its entrance plays again', () => {
    const plan = planTextReader(reading('phrase'), 1920, 1080);
    const second = resolveTextReader(reading('phrase'), 1920, 1080, plan.ends[0] + 0.05)!;
    expect(second.index).toBe(1);
    expect(second.time).toBeCloseTo(0.05, 3);
  });

  it('loops, or holds on the last piece when looping is off', () => {
    const plan = planTextReader(reading('phrase'), 1920, 1080);
    expect(resolveTextReader(reading('phrase'), 1920, 1080, plan.total + 0.01)!.index).toBe(0);
    const held = resolveTextReader(reading('phrase', { loop: false }), 1920, 1080, plan.total + 500)!;
    expect(held.index).toBe(plan.chunks.length - 1);
  });

  it('fills pages with wrapped lines that fit the frame', () => {
    const long = Array.from({ length: 40 }, () => story).join(' ');
    const plan = planTextReader({ ...reading('page'), text: long, fontSize: 80 }, 1920, 1080);
    expect(plan.chunks.length).toBeGreaterThan(3);
    for (const page of plan.chunks) {
      expect(page.split('\n').length).toBeLessThanOrEqual(Math.floor((1080 * 0.86) / 96));
      expect(page.replace(/\n/g, '').length).toBeLessThanOrEqual(400);
    }
    expect(plan.chunks.join(' ').replace(/\n/g, ' ')).toBe(long);
  });

  it('handles a book-length text quickly and keeps one atlas for all of it', () => {
    const book = Array.from({ length: 3000 }, () => story).join(' ');
    const content = { ...reading('phrase'), text: book };
    const started = performance.now();
    const plan = planTextReader(content, 1920, 1080);
    const first = performance.now() - started;
    expect(plan.chunks.length).toBeGreaterThan(20000);
    expect(first).toBeLessThan(1500);
    const again = performance.now();
    for (let i = 0; i < 2000; i += 1) resolveTextReader(content, 1920, 1080, i * 7.3);
    expect(performance.now() - again).toBeLessThan(200);
    // The atlas key depends on the characters used, not on the piece being shown.
    expect(textAtlasSignature(content)).toBe(textAtlasSignature({ ...content, text: story }));
  });
});
