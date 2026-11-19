import {describe,it,expect} from 'vitest';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {CHIP_SAMPLES,renderChipSample} from './chiptune';
import {soundById,soundGroups} from './library';
import {encodeWav} from '../wav';

describe('original 8-bit sample suite',()=>{
 it('is available on the sound menus and renders deterministic, bounded, audible PCM',()=>{
  expect(soundGroups().find(g=>g.category==='chiptune')?.sounds).toHaveLength(20);
  for(const s of CHIP_SAMPLES) {
   expect(soundById(s.id)).toBeTruthy();
   for(const sr of [44100,48000]) {
    const pcm=renderChipSample(s,60,sr);
    let peak=0,power=0;
    for(const x of pcm){expect(Number.isFinite(x)).toBe(true);peak=Math.max(peak,Math.abs(x));power+=x*x;}
    expect(peak,s.id).toBeGreaterThan(.05);expect(peak,s.id).toBeLessThan(.65);
    expect(Math.sqrt(power/pcm.length),s.id).toBeGreaterThan(.01);
    expect(Math.abs(pcm[0]),s.id).toBeLessThan(.001);
    expect(Math.abs(pcm.at(-1)!),s.id).toBeLessThan(.002);
    expect(renderChipSample(s,60,sr)).toEqual(pcm);
   }
   const out=process.env.GA_CHIP_SAMPLE_DIR;
   if(out){mkdirSync(out,{recursive:true});const pcm=renderChipSample(s,60,48000);writeFileSync(join(out,`${s.id}${s.pitched?'-C4':''}.wav`),encodeWav(pcm,pcm,48000));}
  }
 });
 it('tracks pitched notes while percussion stays fixed',()=>{
  for(const s of CHIP_SAMPLES) {
   const a=renderChipSample(s,60),b=renderChipSample(s,72);
   if(s.pitched)expect(a).not.toEqual(b);else expect(a).toEqual(b);
  }
 });
});
