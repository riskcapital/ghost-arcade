import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FLOOR_COLLECTIONS, FLOOR_BEATS, FLOOR_MELODIC, FLOOR_LEADS } from './floorLibrary';
import { beatPattern, loopNotesBetween } from './loops';
import { clipFromPreset, normalizeClip, presetsFor } from './session';
import { ToneEngine, DrumEngine } from './tone/toneDsp';
import { toneById } from './tone/tones';
import { kitById } from './tone/kits';
import { DRUM_VOICES } from './noteEvents';
import { stepsBetween } from './drumPattern';
import { encodeWav } from './wav';
import { SCALES, type ScaleId } from './studioSets';
const key = {root:5,scale:'minor' as const};
const melodic = [...FLOOR_MELODIC,...FLOOR_LEADS];

describe('performance collections', () => {
  it('exposes every part in the browser and keeps it through project normalization', () => {
    for (const c of FLOOR_COLLECTIONS) {
      expect(kitById(c.kit),c.id).toBeTruthy();
      for (const role of ['beats','bass','chords','lead'] as const) {
        const id = `floor-${c.id}-${role === 'beats' ? 'beat' : role}`;
        expect(presetsFor(role).some(p => p.id === id),id).toBe(true);
        const clip = clipFromPreset(id,key,id)!;
        expect(clip,id).toBeTruthy();
        expect(normalizeClip(JSON.parse(JSON.stringify(clip))),id).toEqual(clip);
      }
    }
  });
  it('uses genre backbeats, distinct second bars, and open-hat space', () => {
    for (const c of FLOOR_COLLECTIONS) {
      const b = FLOOR_BEATS.find(b => b.id === `floor-${c.id}-beat`)!;
      expect(Object.values(b.rows).some(r => r!.slice(0,16) !== r!.slice(16)),c.id).toBe(true);
      if (c.style === 'dnb') for (const step of [4,12,20,28]) expect(b.rows.snare![step],c.id).toBe('x');
      if (c.style === 'dubstep') for (const step of [8,24]) expect(b.rows.snare![step],c.id).toBe('x');
      if (c.style === 'house') for (let step=0;step<32;step+=4) expect(b.rows.kick![step],c.id).toBe('x');
      if (c.id === 'yard') for (const step of [0,16]) expect(b.rows.kick![step]).toBe('.');
    }
  });
  it('repeats a recognizable hook, answers it, and resolves home without overrunning the phrase', () => {
    for (const c of FLOOR_COLLECTIONS) {
      // A hook written out over all four bars follows its own shape, not the bar-by-bar one.
      if (c.hookLine) continue;
      const l = FLOOR_LEADS.find(l => l.id === `floor-${c.id}-lead`)!;
      const bar = (b:number) => l.notes.filter(n => Math.round(n.beat*8)/8 >= b*4 && Math.round(n.beat*8)/8 < b*4+4).map(n => n.degrees[0]-c.roots[b]);
      expect(bar(0),c.id).toEqual(bar(2));
      expect(bar(1),c.id).not.toEqual(bar(0));
      expect(l.notes.at(-1)!.degrees,c.id).toEqual([7+(c.leadOctave ?? 0)*7]);
    }
    for (const l of melodic) for (const n of l.notes) expect(n.beat+n.dur,l.id).toBeLessThanOrEqual(l.beats);
  });
  it('keeps the starter hooks low and stepwise in every key', () => {
    const starters = ['chrome','oxide','magnet','blacksteel','aurora','cobalt','velvet','yard'];
    for (const id of starters) {
      const c = FLOOR_COLLECTIONS.find(c => c.id === id)!;
      const span = [...c.hook,...c.answer].map(h => h[2]);
      expect(Math.max(...span)-Math.min(...span),id).toBeLessThanOrEqual(5);
      for (const scale of Object.keys(SCALES) as ScaleId[]) for (let root=0;root<12;root++) {
        const clip = clipFromPreset(`floor-${id}-lead`,{root,scale},id)!;
        const notes = clip.kind === 'notes' ? clip.notes.map(n => n.note) : [];
        expect(Math.max(...notes),`${id} ${root} ${scale}`).toBeLessThanOrEqual(72);
      }
    }
  });

  for (const c of FLOOR_COLLECTIONS) it(`${c.name} renders a complete phrase with headroom and releases`, () => {
    const sr=48000, size=128, seconds=16*60/c.bpm+2;
    const drum = new DrumEngine(sr);
    drum.message({t:'kit',kit:kitById(c.kit)!},0);
    drum.message({t:'tempo',bpm:c.bpm},0);
    const pattern=beatPattern(FLOOR_BEATS.find(l => l.id === `floor-${c.id}-beat`)!);
    for (const h of stepsBetween(pattern,0,16)) drum.message({t:'hit',slot:DRUM_VOICES.indexOf(h.voice),vel:h.velocity,at:h.beat*60/c.bpm,
      tweak:{tune:0.5,decay:0.5,tone:0.5,drive:0.5,level:0.5}},0);
    const engines = [drum, ...melodic.filter(l => l.id.startsWith(`floor-${c.id}-`)).map(l => {
      const e = new ToneEngine(sr);
      e.message({t:'patch',patch:toneById(l.tone)!.patch},0);
      e.message({t:'tempo',bpm:c.bpm},0);
      for (const n of loopNotesBetween(l,key,0,0,16)) {
        e.message({t:'on',note:n.note,vel:n.velocity,at:n.beat*60/c.bpm},0);
        e.message({t:'off',note:n.note,at:(n.beat+n.dur)*60/c.bpm},0);
      }
      return e;
    })];
    const frames=Math.ceil(seconds*sr/size)*size;
    const left=new Float32Array(frames),right=new Float32Array(frames);
    const drumStem=c.style === 'jungle' ? new Float32Array(frames) : null;
    const l=new Float32Array(size),r=new Float32Array(size);
    let peak=0,power=0,tail=0;
    for(let offset=0;offset<frames;offset+=size) {
      for(const e of engines) {
        l.fill(0);r.fill(0);e.process(l,r,size,offset/sr);
        // A fixed mix, not peak normalization: tests catch runaway patches.
        const gain=e === drum ? 0.7 : 0.3;
        if(e === drum && drumStem) for(let i=0;i<size;i++) drumStem[offset+i]=l[i]*gain;
        for(let i=0;i<size;i++){left[offset+i]+=l[i]*gain;right[offset+i]+=r[i]*gain;}
      }
      for(let i=offset;i<offset+size;i++) {
        peak=Math.max(peak,Math.abs(left[i]),Math.abs(right[i]));
        power+=left[i]*left[i];
        if(i>frames-sr/4) tail=Math.max(tail,Math.abs(left[i]),Math.abs(right[i]));
      }
    }
    expect(Number.isFinite(peak)).toBe(true);
    expect(peak).toBeLessThan(1);
    expect(Math.sqrt(power/frames)).toBeGreaterThan(0.01);
    expect(tail).toBeLessThan(0.02);
    // Optional audition artifacts from the same DSP used by the app.
    const out=process.env.GA_MUSIC_PREVIEW_DIR;
    if(out) {
      mkdirSync(out,{recursive:true});
      writeFileSync(join(out,`${c.id}-${c.bpm}bpm.wav`),encodeWav(left,right,sr));
      if(drumStem) writeFileSync(join(out,`${c.id}-drums-${c.bpm}bpm.wav`),encodeWav(drumStem,drumStem,sr));
    }
  });
});
