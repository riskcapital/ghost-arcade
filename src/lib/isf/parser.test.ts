import { describe, it, expect } from 'vitest';
import { parseISF, detectAudioReady } from './parser';

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
