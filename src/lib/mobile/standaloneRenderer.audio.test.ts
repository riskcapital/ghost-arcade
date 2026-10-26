import { describe, expect, it } from 'vitest';
import { audioMotionFor, declareBandClocks, flowRate, injectBreath } from './standaloneRenderer';
import { MOBILE_SHADERS } from './standaloneShaderList';

const shader = `precision highp float;
uniform vec2 RENDERSIZE;
uniform float TIME;
#define isf_FragNormCoord (gl_FragCoord.xy / RENDERSIZE)
float ring(vec2 p) { return length(p - gl_FragCoord.xy); }
void main() {
  vec2 uv = isf_FragNormCoord;
  gl_FragColor = vec4(uv, ring(uv) * 0.0, 1.0);
}
`;

describe('breathing patch', () => {
  it('routes every pixel read through the breathing coordinate, set first thing in main', () => {
    const out = injectBreath(shader, true);
    // The only raw reads left are the two in the setup that builds the breathing coordinate.
    expect(out.match(/\bgl_FragCoord\b/g)).toHaveLength(2);
    expect(out).toContain('#define isf_FragNormCoord (ga_FragCoord.xy / RENDERSIZE)');
    expect(out).toContain('float ring(vec2 p) { return length(p - ga_FragCoord.xy); }');
    expect(out.indexOf('uniform vec4 gaBreath;')).toBeGreaterThan(out.indexOf('precision highp float;'));
    expect(out.indexOf('uniform vec4 gaBreath;')).toBeLessThan(out.indexOf('float ring'));
    const main = out.indexOf('void main() {');
    expect(out.indexOf('ga_FragCoord = vec4(gaC + gaP, gl_FragCoord.zw);')).toBeGreaterThan(main);
    expect(out.indexOf('ga_FragCoord = vec4(gaC + gaP, gl_FragCoord.zw);')).toBeLessThan(out.indexOf('vec2 uv = isf_FragNormCoord;'));
    // Glow last in main, after the shader wrote its colour.
    expect(out.lastIndexOf('gl_FragColor.rgb *= (1.0 + gaBreath.z) * gaTint;')).toBeGreaterThan(out.indexOf('gl_FragColor = vec4(uv'));
  });
  it('leaves glow out when the shader handles its own brightness, and skips a shader without main', () => {
    expect(injectBreath(shader, false)).not.toContain('gaTint;\n}');
    expect(injectBreath(shader, false)).not.toMatch(/gl_FragColor\.rgb \*= \(1\.0 \+ gaBreath/);
    expect(injectBreath('float f() { return 1.0; }', true)).toBe('float f() { return 1.0; }');
  });
  it('declares a band clock only where a patch uses it', () => {
    expect(declareBandClocks(shader)).toBe(shader);
    const patched = declareBandClocks(shader.replace('uniform float TIME;', 'uniform float TIME;\nfloat t = (TIME + audioBassTime * 1.5);'));
    expect(patched.match(/uniform float audioBassTime;/g)).toHaveLength(1);
    expect(patched).not.toContain('audioMidTime;');
  });
});

describe('the flow clock', () => {
  it('runs at normal speed without a live source or at a song’s usual energy, and stays within bounds', () => {
    expect(flowRate(0.65, 0, 0.95)).toBe(1);
    expect(flowRate(0.65, 1, 0.5)).toBe(1);
    expect(flowRate(0.65, 1, 0.9)).toBeGreaterThan(1.4);
    expect(flowRate(0.65, 1, 0.1)).toBeLessThan(0.6);
    expect(flowRate(1, 2, 1)).toBe(2);
    expect(flowRate(1, 2, 0)).toBe(0.55);
  });
  it('gives shaders without audio of their own the most movement', () => {
    expect(audioMotionFor(false)).toEqual({ flow: 0.65, breath: 1, glow: true });
    expect(audioMotionFor(true)).toEqual({ flow: 0.3, breath: 0.45, glow: false });
    expect(audioMotionFor(true, { flow: 0 })).toMatchObject({ flow: 0, breath: 0.45 });
  });
});

describe('per-shader audio patches', () => {
  it('never multiply time by an audio value (the animation would lurch); they use band clocks', () => {
    const offenders = MOBILE_SHADERS.flatMap(s => (s.audioInject ?? []).map(p => ({ id: s.id, replace: p.replace })))
      .filter(p => /TIME\s*\*[^;]*\baudio(Bass|Mid|High|Level|Beat)\b(?!Time)/.test(p.replace) || /\baudio(Bass|Mid|High|Level|Beat)\b(?!Time)[^;]*\*\s*TIME/.test(p.replace));
    expect(offenders).toEqual([]);
  });
});
