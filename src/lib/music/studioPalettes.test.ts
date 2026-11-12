import { describe, expect, it } from 'vitest';
import { AUTO_PALETTE, atFullBrightness, CLASSIC_COLORS, CLASSIC_PALETTE, KEY_PALETTE, KeyHueGlide, STUDIO_PALETTE_LIST, keyHue, resolvePalette, voiceColors } from './studioPalettes';
import { defaultStudioSource, normalizeStudioSource, studioVoiceValues, studioVoicesFromScene } from './studioPlugin';

const dDorian = { root: 2, scale: 'dorian' as const };

describe('studio palettes', () => {
  it('ship twelve, each with all five colours in range', () => {
    expect(STUDIO_PALETTE_LIST).toHaveLength(12);
    for (const p of STUDIO_PALETTE_LIST) {
      for (const slot of [p.ground, p.body, p.accent, p.light, p.shadow]) {
        expect(slot).toHaveLength(3);
        for (const c of slot) expect(c >= 0 && c <= 1).toBe(true);
      }
    }
  });

  it('changing the palette changes every voice in the scene', () => {
    const voices = studioVoicesFromScene([
      { file: 'VX-Nebula.fs', source: 'pad' }, { file: 'VX-Barcode.fs', source: 'kick' },
      { file: 'VX-BitCounter.fs', source: 'bass' }, { file: 'VX-Scope.fs', source: 'lead' },
    ]);
    const inks = (id: string) => voices.map((v) => JSON.stringify(studioVoiceValues(v, 'berlin', {}, { id, slots: resolvePalette(id, 'berlin', dDorian) }).ink));
    const a = inks('deep-sea');
    const b = inks('blood-orange');
    a.forEach((ink, i) => expect(ink).not.toBe(b[i]));
  });

  it('gives each voice the colour of its role, so a scene reads as one picture', () => {
    const slots = resolvePalette('deep-sea', 'bath', dDorian);
    expect(voiceColors('deep-sea', slots, 'pad').ink).toEqual(atFullBrightness(slots.ground));
    expect(voiceColors('deep-sea', slots, 'bass').ink).toEqual(atFullBrightness(slots.body));
    expect(voiceColors('deep-sea', slots, 'kick').ink).toEqual(atFullBrightness(slots.accent));
    expect(voiceColors('deep-sea', slots, 'lead').ink).toEqual(atFullBrightness(slots.light));
    // Inks are at full brightness: a palette colours the voices without dimming them.
    expect(Math.max(...voiceColors('deep-sea', slots, 'pad').ink)).toBeCloseTo(1, 6);
  });

  it('keeps older projects in their set\'s original two colours, and starts new instances on Auto', () => {
    expect(normalizeStudioSource({ musicSet: 'dub' }).musicPalette).toBe(CLASSIC_PALETTE);
    const v = studioVoicesFromScene([{ file: 'VX-Barcode.fs', source: 'kick' }])[0];
    const old = studioVoiceValues(v, 'dub', {});
    expect(old.ink).toEqual([...CLASSIC_COLORS.dub.ink, 1]);
    expect(old.accent).toEqual([...CLASSIC_COLORS.dub.accent, 1]);
    expect(defaultStudioSource().musicPalette).toBe(AUTO_PALETTE);
    expect(resolvePalette(AUTO_PALETTE, 'bath', dDorian)).toEqual(resolvePalette('deep-sea', 'bath', dDorian));
  });

  it('Key colour: related keys get related hues, around the circle of fifths', () => {
    const c = keyHue({ root: 0, scale: 'major' });
    const g = keyHue({ root: 7, scale: 'major' });
    const fSharp = keyHue({ root: 6, scale: 'major' });
    const near = (a: number, b: number) => Math.min(Math.abs(a - b), 1 - Math.abs(a - b));
    expect(near(c, g)).toBeCloseTo(1 / 12, 5);
    expect(near(c, fSharp)).toBeCloseTo(0.5, 5);
    // Minor sits deeper than major on the same root.
    const lum = (rgb: number[]) => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
    const major = resolvePalette(KEY_PALETTE, 'berlin', { root: 0, scale: 'major' });
    const minor = resolvePalette(KEY_PALETTE, 'berlin', { root: 0, scale: 'minor' });
    expect(lum(minor.body)).toBeLessThan(lum(major.body));
  });

  it('a key change glides over about a bar, the short way round', () => {
    const glide = new KeyHueGlide();
    expect(glide.step(0.95, 0)).toBe(0.95);
    // Heading to 0.05: the short way crosses 0, not back through 0.5.
    const next = glide.step(0.05, 100);
    expect(next > 0.95 || next < 0.05).toBe(true);
    let h = next;
    for (let t = 200; t <= 4000; t += 100) h = glide.step(0.05, t);
    expect(h).toBeCloseTo(0.05, 3);
  });
});
