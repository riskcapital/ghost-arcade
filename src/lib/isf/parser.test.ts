import { describe, it, expect } from 'vitest';
import { parseISF, detectAudioReady, getISFPassPlan, getISFAudioUsage, shaderUsesISFAudioRows } from './parser';

describe('detectAudioReady', () => {
  it('returns true when audio uniforms are present', () => {
    expect(detectAudioReady('uniform float audioLevel;')).toBe(true);
    expect(detectAudioReady('some code using audioBass here')).toBe(true);
    expect(detectAudioReady('uniform sampler2D audioFFT;')).toBe(true);
  });

  it('returns false when no audio uniforms exist', () => {
    expect(detectAudioReady('uniform float brightness;')).toBe(false);
    expect(detectAudioReady('void main() { gl_FragColor = vec4(1.0); }')).toBe(false);
  });

  it('does not match partial names', () => {
    expect(detectAudioReady('myAudioLevel = 1.0;')).toBe(false);
    expect(detectAudioReady('audioLevelMax')).toBe(false);
  });
});

describe('parseISF', () => {
  it('extracts metadata from ISF comment block', () => {
    const source = `/*{
  "DESCRIPTION": "Test shader",
  "INPUTS": [
    { "NAME": "brightness", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0 }
  ]
}*/
void main() {
  gl_FragColor = vec4(brightness);
}`;
    const result = parseISF(source);
    expect(result.metadata.DESCRIPTION).toBe('Test shader');
    expect(result.metadata.INPUTS).toHaveLength(1);
    expect(result.metadata.INPUTS[0].NAME).toBe('brightness');
    expect(result.metadata.INPUTS[0].TYPE).toBe('float');
    expect(result.metadata.INPUTS[0].DEFAULT).toBe(0.5);
  });

  it('handles missing metadata gracefully', () => {
    const source = 'void main() { gl_FragColor = vec4(1.0); }';
    const result = parseISF(source);
    expect(result.metadata.INPUTS).toEqual([]);
    expect(result.fragmentShader).toContain('void main()');
  });

  it('handles invalid JSON metadata', () => {
    const source = '/*{ invalid json }*/\nvoid main() {}';
    const result = parseISF(source);
    expect(result.metadata.INPUTS).toEqual([]);
  });

  it('removes metadata block from shader source', () => {
    const source = `/*{ "INPUTS": [] }*/\nvoid main() { gl_FragColor = vec4(1.0); }`;
    const result = parseISF(source);
    expect(result.fragmentShader).not.toContain('INPUTS');
    expect(result.fragmentShader).toContain('void main()');
  });

  it('detects audio readiness', () => {
    const audioShader = `/*{ "INPUTS": [] }*/\nuniform float audioLevel;\nvoid main() {}`;
    const result = parseISF(audioShader);
    expect(result.isAudioReady).toBe(true);
  });

  it('adds RENDERSIZE uniform when not declared', () => {
    const source = `/*{ "INPUTS": [] }*/\nvoid main() { vec2 uv = gl_FragCoord.xy / RENDERSIZE; }`;
    const result = parseISF(source);
    expect(result.fragmentShader).toContain('uniform vec2 RENDERSIZE;');
  });

  it('generates uniform declarations for inputs', () => {
    const source = `/*{
  "INPUTS": [
    { "NAME": "speed", "TYPE": "float" },
    { "NAME": "enabled", "TYPE": "bool" },
    { "NAME": "mode", "TYPE": "long" }
  ]
}*/
void main() {}`;
    const result = parseISF(source);
    expect(result.fragmentShader).toContain('uniform float speed;');
    expect(result.fragmentShader).toContain('uniform bool enabled;');
    expect(result.fragmentShader).toContain('uniform int mode;');
  });
});

describe('getISFPassPlan', () => {
  it('normalizes ISF 2 PASSES with persistent, float and size expressions', () => {
    const plan = getISFPassPlan({
      PASSES: [
        { TARGET: 'trail', PERSISTENT: true, FLOAT: true },
        { TARGET: 'half', WIDTH: '$WIDTH/2', HEIGHT: 64 },
        { TARGET: 'half' },
        {},
      ],
    });
    expect(plan.multipass).toBe(true);
    expect(plan.passes.map((pass) => pass.target)).toEqual(['trail', 'half', 'half', null]);
    expect(plan.targets).toEqual([
      { name: 'trail', persistent: true, float: true, width: undefined, height: undefined },
      { name: 'half', persistent: false, float: false, width: '$WIDTH/2', height: '64' },
    ]);
  });

  it('accepts ISF 1 PERSISTENT_BUFFERS as a list or an object', () => {
    expect(getISFPassPlan({ PERSISTENT_BUFFERS: ['fb'], PASSES: [{ TARGET: 'fb' }, {}] }).targets[0].persistent).toBe(true);
    const plan = getISFPassPlan({ PERSISTENT_BUFFERS: { acc: { WIDTH: '$WIDTH', FLOAT: true } } });
    expect(plan.targets).toEqual([{ name: 'acc', persistent: true, float: true, width: '$WIDTH', height: undefined }]);
    expect(plan.multipass).toBe(true);
  });

  it('treats a shader without PASSES as single pass and caps targets at 8', () => {
    expect(getISFPassPlan({}).multipass).toBe(false);
    const passes = Array.from({ length: 10 }, (_, i) => ({ TARGET: `b${i}` }));
    const plan = getISFPassPlan({ PASSES: [...passes, {}] });
    expect(plan.targets).toHaveLength(8);
    expect(plan.passes).toHaveLength(9);
  });
});

describe('ISF audio rows', () => {
  it('reports declared audio inputs with MAX and built-in helpers', () => {
    const usage = getISFAudioUsage('void main(){ float v = sampleWaveform(0.5); }', {
      INPUTS: [
        { NAME: 'spectrum', TYPE: 'audioFFT', MAX: 16 },
        { NAME: 'speed', TYPE: 'float' },
      ],
    });
    expect(usage.fft).toBe(true);
    expect(usage.waveform).toBe(true);
    expect(usage.inputs).toEqual([{ name: 'spectrum', kind: 'fft', max: 16 }]);
    expect(getISFAudioUsage('void main(){}', { INPUTS: [] })).toEqual({ fft: false, waveform: false, inputs: [] });
  });

  it('detects audio-row shaders from source alone', () => {
    expect(shaderUsesISFAudioRows('{"NAME":"w","TYPE":"audio"}')).toBe(true);
    expect(shaderUsesISFAudioRows('texture2D(audioFFT, uv)')).toBe(true);
    expect(shaderUsesISFAudioRows('float v = audioLevel;')).toBe(false);
  });
});

describe('parseISF multi-pass and audio inputs (browser preview)', () => {
  it('declares pass targets and pins PASSINDEX to the output pass', () => {
    const result = parseISF(`/*{ "INPUTS": [], "PASSES": [{ "TARGET": "buf", "PERSISTENT": true }, {}] }*/
void main() { gl_FragColor = PASSINDEX == 0 ? vec4(1.0) : IMG_NORM_PIXEL(buf, vec2(0.5)); }`);
    expect(result.fragmentShader).toContain('uniform sampler2D buf;');
    expect(result.fragmentShader).toContain('#define PASSINDEX 1');
  });

  it('aliases audio inputs onto the shared audio textures', () => {
    const result = parseISF(`/*{ "INPUTS": [{ "NAME": "fft", "TYPE": "audioFFT", "MAX": 8 }, { "NAME": "wave", "TYPE": "audio" }] }*/
void main() { gl_FragColor = texture2D(fft, vec2(0.5)) + texture2D(wave, vec2(0.5)); }`);
    expect(result.fragmentShader).toContain('#define fft audioFFT');
    expect(result.fragmentShader).toContain('#define wave audioWaveform');
    expect(result.fragmentShader.indexOf('uniform sampler2D audioFFT;')).toBeLessThan(result.fragmentShader.indexOf('void main'));
  });
});
