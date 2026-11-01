import { describe, expect, it } from 'vitest';
import { demoVoiceCode, voiceRespondsTo } from './voiceThumbnails';

const CODE = `/*{
  "INPUTS": [
    { "NAME": "scale", "TYPE": "float", "DEFAULT": 0.5 },
    { "NAME": "vxEnergy", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
    { "NAME": "vxHit", "TYPE": "float", "DEFAULT": 0 }
  ]
}*/
void main() { gl_FragColor = vec4(vxEnergy * vxHit * scale); }`;

describe('voice thumbnails', () => {
  it('sets the sound inputs as if a phrase were playing, and nothing else', () => {
    const demo = demoVoiceCode(CODE);
    expect(demo).toContain('"NAME": "vxEnergy", "TYPE": "float", "DEFAULT": 0.75');
    expect(demo).toContain('"NAME": "vxHit", "TYPE": "float", "DEFAULT": 0.9');
    expect(demo).toContain('"NAME": "scale", "TYPE": "float", "DEFAULT": 0.5');
  });

  it('says what a voice answers to', () => {
    expect(voiceRespondsTo(CODE)).toBe('hits, level');
  });
});
