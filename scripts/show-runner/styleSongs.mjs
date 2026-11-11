// Synthetic songs in five styles, with a known structure, for Auto show's
// style tests (src/lib/timeline/autoshow/songStyle.test.ts) and the Show
// Runner's fixtures (`song-<style>.wav`). Plain synthesis (sines, noise,
// decaying kicks), seeded, so the same song comes out every time.
//
//   chill      84 BPM: pads, a soft kick on 1, rimshot on 3, quiet hats
//   groove     110 BPM: kick on 1, the "and" of 2 and 3, snare on 2 and 4,
//              eighth hats, a walking bass
//   driving    128 BPM: four on the floor, off-beat hats, eighth bass,
//              builds and drops
//   hard       150 BPM: heavy four on the floor, sixteenth hats, a
//              distorted sub bass, quiet breakdowns between huge drops
//   cinematic  no beat: slow pad swells, a long rising build, a few
//              impacts off any grid

/** The structure of each style's song: [part, bars]. */
export const STYLE_SONGS = {
  chill: { bpm: 84, parts: [['intro', 8], ['verse', 16], ['bridge', 8], ['verse', 16], ['outro', 8]] },
  groove: { bpm: 110, parts: [['intro', 8], ['verse', 16], ['build', 4], ['chorus', 16], ['bridge', 8], ['chorus', 16], ['outro', 8]] },
  driving: { bpm: 128, parts: [['intro', 16], ['build', 8], ['drop', 16], ['breakdown', 8], ['build', 8], ['drop', 16], ['outro', 8]] },
  hard: { bpm: 150, parts: [['intro', 8], ['build', 8], ['drop', 16], ['breakdown', 8], ['build', 8], ['drop', 16], ['outro', 4]] },
  cinematic: { bpm: 70, parts: [['swell', 12], ['rise', 24], ['impact', 8], ['still', 12]] },
};

/** Mono samples of a style's song (`scale`: the song's length, `bpm`: another tempo). */
export function styleSong(style, sampleRate = 22050, opts = {}) {
  const base = STYLE_SONGS[style];
  if (!base) throw new Error(`no style song ${style}`);
  const spec = { ...base, bpm: opts.bpm ?? base.bpm };
  const scale = opts.scale ?? 1;
  const parts = spec.parts.map(([p, b]) => [p, Math.max(2, Math.round(b * scale))]);
  const beat = 60 / spec.bpm;
  const bar = beat * 4;
  const totalBars = parts.reduce((n, p) => n + p[1], 0);
  const n = Math.ceil((totalBars * bar + 1) * sampleRate);
  const out = new Float32Array(n);
  let seed = 11 >>> 0;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 * 2 - 1; };
  const add = (t0, dur, fn) => {
    const a = Math.max(0, Math.floor(t0 * sampleRate));
    const b = Math.min(n, Math.floor((t0 + dur) * sampleRate));
    for (let i = a; i < b; i++) out[i] += fn(i / sampleRate - t0);
  };
  const kick = (t0, amp, decay = 18) => add(t0, 0.3, (t) => amp * Math.exp(-t * decay) * Math.sin(2 * Math.PI * (45 * t + 40 * (1 - Math.exp(-t * 30)) / 30)));
  const noiseHit = (t0, amp, len) => add(t0, len, (t) => amp * Math.exp(-t * 5 / len) * rnd());
  const chord = [220, 277.2, 329.6];
  const pad = (t0, dur, amp, swell = false) => add(t0, dur, (t) => amp * (swell ? Math.min(1, t / dur * 1.2) : 1) * chord.reduce((s, f) => s + Math.sin(2 * Math.PI * f * t), 0) / 3);
  const bass = (t0, dur, amp, f = 55) => add(t0, dur, (t) => amp * Math.exp(-t * 6) * (((f * t) % 1) * 2 - 1));
  const sub = (t0, dur, amp) => add(t0, dur, (t) => amp * Math.tanh(3 * Math.sin(2 * Math.PI * 49 * t)) * Math.exp(-t * 2.5));
  const bell = (t0, amp) => add(t0, 1.2, (t) => amp * Math.exp(-t * 3) * Math.sin(2 * Math.PI * 880 * t));

  let t = 0;
  for (const [part, bars] of parts) {
    for (let b = 0; b < bars; b++) {
      const bt = t + b * bar;
      const progress = bars > 1 ? b / (bars - 1) : 1;
      if (style === 'chill') {
        pad(bt, bar, 0.09);
        if (part === 'verse') {
          kick(bt, 0.25, 9);
          noiseHit(bt + 2 * beat, 0.05, 0.04);
          for (let e = 0; e < 4; e++) noiseHit(bt + e * beat + beat / 2, 0.015, 0.03);
          bass(bt, 2 * beat, 0.05, 55); bass(bt + 2 * beat, 2 * beat, 0.05, 41.2);
        } else if (part === 'bridge') {
          bell(bt, 0.04); bell(bt + 2 * beat, 0.03);
        } else if (part === 'intro' || part === 'outro') {
          for (let e = 0; e < 4; e++) noiseHit(bt + e * beat + beat / 2, 0.01 * (part === 'outro' ? 1 - progress : 1), 0.03);
        }
      } else if (style === 'groove') {
        pad(bt, bar, 0.05);
        const full = part === 'verse' || part === 'chorus';
        if (full || part === 'outro' || part === 'build') {
          const a = part === 'chorus' ? 0.7 : 0.55;
          kick(bt, a); kick(bt + 1.5 * beat, a * 0.8); kick(bt + 2 * beat, a);
          noiseHit(bt + beat, 0.25, 0.09); noiseHit(bt + 3 * beat, 0.25, 0.09);
          for (let e = 0; e < 8; e++) noiseHit(bt + e * beat / 2, 0.05, 0.03);
          const notes = [55, 55, 65.4, 73.4];
          for (let e = 0; e < 4; e++) bass(bt + e * beat, beat, 0.14, notes[e]);
        } else if (part === 'intro') {
          for (let e = 0; e < 8; e++) noiseHit(bt + e * beat / 2, 0.04, 0.03);
          for (let e = 0; e < 4; e++) bass(bt + e * beat, beat, 0.1);
        } else if (part === 'bridge') {
          pad(bt, bar, 0.06);
          noiseHit(bt + beat, 0.12, 0.09); noiseHit(bt + 3 * beat, 0.12, 0.09);
        }
      } else if (style === 'driving' || style === 'hard') {
        const hard = style === 'hard';
        pad(bt, bar, hard ? 0.04 : 0.07);
        if (part === 'intro') {
          for (let e = 0; e < 4; e++) kick(bt + e * beat, hard ? 0.4 : 0.55);
          for (let e = 0; e < 4; e++) noiseHit(bt + e * beat + beat / 2, 0.05, 0.03);
        } else if (part === 'build') {
          const perBeat = progress < 0.4 ? 1 : progress < 0.75 ? 2 : 4;
          for (let k = 0; k < 4 * perBeat; k++) noiseHit(bt + k * beat / perBeat, 0.08 + 0.2 * progress, 0.06);
          add(bt, bar, (x) => (0.02 + 0.12 * (progress + x / bar / bars)) * rnd());
        } else if (part === 'drop') {
          for (let e = 0; e < 4; e++) kick(bt + e * beat, hard ? 1 : 0.9, hard ? 14 : 18);
          if (hard) {
            for (let e = 0; e < 16; e++) noiseHit(bt + e * beat / 4, 0.09, 0.025);
            for (let e = 0; e < 4; e++) sub(bt + e * beat + beat / 2, beat / 2, 0.45);
            noiseHit(bt + beat, 0.5, 0.12); noiseHit(bt + 3 * beat, 0.5, 0.12);
            if (b % 2 === 1) for (let e = 0; e < 4; e++) noiseHit(bt + 3 * beat + e * beat / 4, 0.3, 0.05);
          } else {
            for (let e = 0; e < 8; e++) bass(bt + e * beat / 2, beat / 2, 0.3);
            noiseHit(bt + beat, 0.35, 0.1); noiseHit(bt + 3 * beat, 0.35, 0.1);
            for (let e = 0; e < 4; e++) noiseHit(bt + e * beat + beat / 2, 0.1, 0.03);
          }
        } else if (part === 'breakdown') {
          pad(bt, bar, hard ? 0.05 : 0.09);
        } else if (part === 'outro') {
          const fade = 1 - 0.8 * progress;
          for (let e = 0; e < 4; e++) kick(bt + e * beat, 0.5 * fade);
          for (let e = 0; e < 8; e++) noiseHit(bt + e * beat / 2, 0.05 * fade, 0.03);
        }
      } else if (style === 'cinematic') {
        if (part === 'swell') pad(bt, bar, 0.04 + 0.06 * progress, true);
        else if (part === 'rise') {
          pad(bt, bar, 0.1);
          add(bt, bar, (x) => (0.01 + 0.2 * Math.pow(progress + x / bar / bars, 2)) * rnd());
        } else if (part === 'impact') {
          pad(bt, bar, 0.12);
          // A few impacts, off any grid.
          if (b % 3 === 0) { sub(bt + 0.37 * bar, 1.5, 0.6); noiseHit(bt + 0.37 * bar, 0.5, 0.8); }
        } else if (part === 'still') {
          pad(bt, bar, 0.05 * (1 - 0.7 * progress));
          if (b % 4 === 1) bell(bt + 0.6 * bar, 0.03);
        }
      }
    }
    t += bars * bar;
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0.95) for (let i = 0; i < n; i++) out[i] *= 0.95 / peak;
  return out;
}

/** Section boundaries of a style's song, seconds (with 0 and the end). */
export function styleSongBoundaries(style, opts = {}) {
  const spec = { ...STYLE_SONGS[style], bpm: opts.bpm ?? STYLE_SONGS[style].bpm };
  const scale = opts.scale ?? 1;
  const bar = (60 / spec.bpm) * 4;
  const out = [0];
  for (const [, b] of spec.parts) out.push(out[out.length - 1] + Math.max(2, Math.round(b * scale)) * bar);
  return out;
}
