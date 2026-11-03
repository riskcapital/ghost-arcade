import { describe, expect, it } from 'vitest';
import { cleanPhrase, normalizePhrases, packPhrase, shaderTextValues } from './shaderText';
import { normalizeStudioVoice, studioVoiceValues } from './studioPlugin';

const unpack = (v: number[], len: number) => {
  const order = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.!?-+':/&";
  let out = '';
  for (let i = 0; i < len; i++) out += order[Math.floor(v[Math.floor(i / 3)] / 64 ** (i % 3)) % 64];
  return out;
};

describe('text for lettering visuals', () => {
  it('cleans a phrase to what the shaders can draw', () => {
    expect(cleanPhrase('  make   noise!  ')).toBe('MAKE NOISE!');
    expect(cleanPhrase('Café #1 ★ ok')).toBe('CAFE 1 OK');
    expect(cleanPhrase('a much longer line than fits')).toBe('A MUCH LONGE');
  });

  it('packs three characters a float, small enough to reach the GPU exactly', () => {
    const v = packPhrase("?!-+':/&. AZ");
    expect(unpack(v, 12)).toBe("?!-+':/&. AZ");
    for (const f of v) expect(f).toBeLessThan(2 ** 18);
  });

  it('cycles phrases by bar or by hit', () => {
    const p = ['ONE', 'TWO', 'THREE'];
    expect(shaderTextValues(p, 4, 0, 0).vxTxtId).toBe(0);
    expect(shaderTextValues(p, 4, 4, 0).vxTxtId).toBe(1);
    expect(shaderTextValues(p, 4, 13, 0).vxTxtId).toBe(0);
    expect(shaderTextValues(p, 0, 9, 5).vxTxtId).toBe(2);
    const v = shaderTextValues(p, 1, 2, 0);
    expect(unpack([v.vxTxt0, v.vxTxt1, v.vxTxt2, v.vxTxt3], v.vxTxtLen)).toBe('THREE');
    expect(shaderTextValues([], 4, 3, 3).vxTxtLen).toBe(0);
  });

  it('is saved with the visual and reaches its shader', () => {
    const voice = normalizeStudioVoice({ file: 'VX-NeonFault.fs', source: 'kick', text: ['hello', '', 'world', 42], textEvery: 2, params: {} })!;
    expect(voice.text).toEqual(['HELLO', 'WORLD', '42']);
    expect(voice.textEvery).toBe(2);
    expect(normalizePhrases('nope')).toEqual([]);
    const values = studioVoiceValues(voice, 'dub', { vxBars: 2, vxCount: 0 });
    expect(values.vxTxtN).toBe(3);
    expect(values.vxTxtId).toBe(1);
  });
});
