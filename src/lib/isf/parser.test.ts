import { describe, it, expect } from 'vitest';
import { parseISF, detectAudioReady, getISFPassTargets } from './parser';

const count = (source: string, text: string) => source.split(text).length - 1;

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

describe('built-in uniform declarations', () => {
  it('declares RENDERSIZE once, before the helpers, when the shader declares it too', () => {
    const source = `/*{ "INPUTS": [] }*/\nuniform float TIME;\nuniform vec2  RENDERSIZE;\nvoid main() { gl_FragColor = vec4(gl_FragCoord.xy / RENDERSIZE, TIME, 1.0); }`;
    const frag = parseISF(source).fragmentShader;
    expect(count(frag, 'uniform vec2 RENDERSIZE;')).toBe(1);
    expect(frag).not.toMatch(/uniform vec2\s{2,}RENDERSIZE/);
    expect(count(frag, 'uniform float TIME;')).toBe(1);
    expect(frag.indexOf('uniform vec2 RENDERSIZE;')).toBeLessThan(frag.indexOf('vec4 IMG_PIXEL('));
  });

  it('aliases a declared renderSize onto RENDERSIZE', () => {
    const source = `/*{ "INPUTS": [] }*/\nuniform vec2 renderSize;\nvoid main() { gl_FragColor = vec4(gl_FragCoord.xy / renderSize, 0.0, 1.0); }`;
    const frag = parseISF(source).fragmentShader;
    expect(frag).toContain('uniform vec2 RENDERSIZE;');
    expect(frag).toContain('#define renderSize RENDERSIZE');
    expect(frag).not.toContain('uniform vec2 renderSize;');
  });

  it('keeps a shader declaration of another type in place of its own', () => {
    const source = `/*{ "INPUTS": [] }*/\nuniform float FRAMEINDEX;\nvoid main() { gl_FragColor = vec4(FRAMEINDEX); }`;
    const frag = parseISF(source).fragmentShader;
    expect(frag).toContain('uniform float FRAMEINDEX;');
    expect(frag).not.toContain('uniform int FRAMEINDEX;');
  });

  it('declares an input that shares a built-in name once', () => {
    const source = `/*{ "INPUTS": [{ "NAME": "audioBass", "TYPE": "float" }] }*/\nvoid main() { gl_FragColor = vec4(audioBass); }`;
    expect(count(parseISF(source).fragmentShader, 'uniform float audioBass;')).toBe(1);
  });
});

describe('integer clamp/min/max', () => {
  it('adds integer overloads for the functions the shader calls', () => {
    const source = `/*{ "INPUTS": [] }*/\nvoid main() { int n = clamp(3, 1, 2); gl_FragColor = vec4(float(n)); }`;
    const frag = parseISF(source).fragmentShader;
    expect(frag).toContain('int clamp(int x, int lo, int hi)');
    expect(frag).not.toContain('int min(int a, int b)');
    expect(frag).not.toContain('int max(int a, int b)');
  });

  it('leaves a shader that defines its own overload alone', () => {
    const source = `/*{ "INPUTS": [] }*/\nint max(int a, int b) { return a > b ? a : b; }\nvoid main() { gl_FragColor = vec4(float(max(1, 2))); }`;
    expect(count(parseISF(source).fragmentShader, 'int max(int a, int b)')).toBe(1);
  });
});

describe('multi-pass shaders', () => {
  it('pins PASSINDEX to the output pass and declares pass targets', () => {
    const source = `/*{
  "INPUTS": [],
  "PASSES": [{ "TARGET": "bufferA", "PERSISTENT": true }, {}]
}*/
uniform int PASSINDEX;
void main() {
  if (PASSINDEX == 0) gl_FragColor = texture2D(bufferA, vUv);
  else gl_FragColor = vec4(1.0);
}`;
    const frag = parseISF(source).fragmentShader;
    expect(frag).toContain('#define PASSINDEX 1');
    expect(frag).not.toContain('uniform int PASSINDEX;');
    expect(frag).toContain('uniform sampler2D bufferA;');
  });

  it('collects targets from PASSES and PERSISTENT_BUFFERS', () => {
    expect(getISFPassTargets({ PASSES: [{ TARGET: 'a' }, {}, { TARGET: 'a' }], PERSISTENT_BUFFERS: ['b'] })).toEqual(['a', 'b']);
    expect(getISFPassTargets({ PERSISTENT_BUFFERS: { trails: { WIDTH: '$WIDTH' } } })).toEqual(['trails']);
    expect(getISFPassTargets({ PASSES: [{ TARGET: 'not valid' }] })).toEqual([]);
  });
});
