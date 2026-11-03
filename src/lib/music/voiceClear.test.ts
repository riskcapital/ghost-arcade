import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseISF } from '../isf/parser';
import { declaresClear, withClearOption } from './voiceClear';
import { normalizeStudioVoice, studioVoiceValues } from './studioPlugin';

const voice = (file: string) => readFileSync(`public/ISF/${file}`, 'utf8');

describe('transparent background for older voices', () => {
  it('adds the input and wraps main so the last pass keys black out', () => {
    const out = withClearOption(voice('VX-Wobbulator.fs'));
    expect(declaresClear(out)).toBe(true);
    const meta = parseISF(out).metadata;
    expect(meta.INPUTS?.some((i) => i.NAME === 'vxClear' && i.TYPE === 'bool')).toBe(true);
    expect(out).toContain('void vxDrawMain()');
    expect(out.match(/void main\(\)/g)?.length).toBe(1);
  });

  it('keys only the final pass of a multi-pass voice', () => {
    expect(withClearOption(voice('VX-NeonFault.fs'))).toMatch(/vxClear && PASSINDEX == 1/);
  });

  it('leaves a voice with its own transparent background and broken code alone', () => {
    const own = '/*{ "INPUTS": [{ "NAME": "vxClear", "TYPE": "bool" }] }*/\nvoid main() { gl_FragColor = vec4(0.0); }';
    expect(withClearOption(own)).toBe(own);
    expect(withClearOption('void main() {}')).toBe('void main() {}');
  });

  it('is saved with the voice and reaches its shader', () => {
    const v = normalizeStudioVoice({ file: 'VX-Barcode.fs', source: 'kick', clear: true, blend: 'normal', params: {} })!;
    expect(v.clear).toBe(true);
    expect(studioVoiceValues(v, 'berlin', {}).vxClear).toBe(true);
    expect(normalizeStudioVoice({ file: 'VX-Barcode.fs', source: 'kick', params: {} })!.clear).toBeUndefined();
  });
});
