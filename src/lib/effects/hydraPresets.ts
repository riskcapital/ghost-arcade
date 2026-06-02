// Curated Hydra sketches shipped with Ghost Arcade as a starter preset
// library. Each sketch is a string of code that runs in a scope where
// every hydra-synth global (osc, noise, voronoi, shape, src, s0..s3,
// o0..o3, a, render, setResolution, etc.) is available as an identifier.
//
// Sketches are referenced from the wider community and the official
// hydra.ojack.xyz examples. Sketch authorship is credited where known.
// This list is intentionally small + curated to give a good first
// impression rather than thousands of variable-quality presets.

export interface HydraPreset {
  name: string;
  code: string;
  /** Optional credit — sketch author when known. */
  by?: string;
}

export const HYDRA_PRESETS: HydraPreset[] = [
  {
    name: 'Welcome',
    by: 'Olivia Jack',
    code: `osc(20, 0.1, 1.4).rotate(0.1).out()`,
  },
  {
    name: 'Pulse Rings',
    code: `osc(40, 0.05, 1.2).color(1, 0.42, 0.42).rotate(() => time*0.1).modulate(noise(3, 0.3), () => a.fft[0]*0.5).out()`,
  },
  {
    name: 'Voronoi Drift',
    code: `voronoi(5, 0.3, 0.3).color(1, 0.55, 0.30).modulate(osc(4, 0.1)).rotate(() => time*0.05).out()`,
  },
  {
    name: 'Liquid Mirror',
    code: `osc(8, 0.1, 1.2).kaleid(3).color(1, 0.4, 0.4).modulate(noise(2)).rotate(() => time*0.2).out()`,
  },
  {
    name: 'Beat Bloom',
    code: `shape(4, () => 0.3 + a.fft[0]*0.4, 0.05).color(1, 0.5, 0.3).scale(1.2).repeat(3, 3).modulate(osc(6)).out()`,
  },
  {
    name: 'Tunnel',
    code: `osc(40, 0.1, 2).kaleid(() => 3 + Math.floor(a.fft[1]*5)).color(1, 0.42, 0.42).modulate(noise(2, 0.5)).out()`,
  },
  {
    name: 'Cellular',
    code: `voronoi(15, 0.3, 1.5).color(1, 0.55, 0.30).modulateScale(osc(4, 0.5)).scale(() => 1 + a.fft[0]*0.4).out()`,
  },
  {
    name: 'Mandala',
    code: `osc(30, 0.05, 1).kaleid(8).color(1, 0.4, 0.6).rotate(() => time*0.15).modulate(noise(3, 0.2)).out()`,
  },
  {
    name: 'Feedback Loop',
    code: `osc(15, 0.1, 1.2).color(1, 0.5, 0.4).modulate(o0, 0.04).rotate(0.02).out()`,
  },
  {
    name: 'Stained Glass',
    code: `noise(4, 0.05).color(1, 0.5, 0.4).kaleid(6).rotate(() => time*0.05).modulate(osc(8, 0.1)).contrast(1.4).out()`,
  },
  {
    name: 'Beat Pulse Shape',
    code: `shape(6, () => 0.4 + a.fft[0]*0.3, 0.1).color(1, 0.5, 0.3).scale(() => 1 + a.fft[1]*0.5).rotate(() => time*0.2).out()`,
  },
  {
    name: 'Plasma',
    code: `osc(10, 0.1, 1.5).modulate(osc(6, 0.05).rotate(1.57)).color(1, 0.4, 0.5).rotate(0.3).out()`,
  },
  {
    name: 'Vortex',
    code: `osc(20, 0.1, 1).kaleid(4).rotate(() => time*0.3 + a.fft[2]).color(1, 0.42, 0.42).modulateRotate(osc(2)).out()`,
  },
  {
    name: 'Audio Rings',
    code: `osc(() => 5 + a.fft[0]*40, 0.05, 1).color(1, 0.55, 0.30).rotate(() => time*0.1).out()`,
  },
  {
    name: 'Hex Grid',
    code: `shape(6, 0.3, 0.02).repeat(8, 8).color(1, 0.5, 0.4).modulate(osc(4, 0.05)).rotate(() => time*0.05).out()`,
  },
  {
    name: 'Soft Wash',
    code: `noise(2, 0.05).color(1, 0.5, 0.4).contrast(1.2).modulate(osc(4, 0.05)).out()`,
  },
  {
    name: 'Spectral Vortex',
    code: `osc(() => 10 + a.fft[2]*60, 0.1, 1).rotate(() => time*0.2).color(1, 0.42, 0.42).kaleid(() => 4 + Math.floor(a.fft[0]*4)).modulate(noise(3)).out()`,
  },
  {
    name: 'Beat Strobe',
    code: `solid(() => a.fft[0], () => a.fft[1]*0.5, () => a.fft[2]*0.4).out()`,
  },
  {
    name: 'Cosmic Web',
    code: `voronoi(20, 0.2, 0.8).thresh(0.5).color(1, 0.55, 0.30).modulate(osc(3, 0.1)).rotate(() => time*0.05).out()`,
  },
  {
    name: 'Heat Shimmer',
    code: `noise(8, 0.3).color(1, 0.45, 0.35).modulate(osc(20, 0.1)).contrast(1.6).out()`,
  },
  {
    name: 'Quantum Cells',
    code: `voronoi(() => 5 + a.fft[1]*15, 0.3, 0.5).color(1, 0.5, 0.4).modulateScale(osc(4, 0.1)).out()`,
  },
  {
    name: 'Echo Chamber',
    code: `shape(99, 0.4, 0.01).color(1, 0.45, 0.4).modulate(o0, 0.05).scrollX(0.005).out()`,
  },
  {
    name: 'Lava Lamp',
    code: `noise(3, 0.05).color(1, 0.5, 0.3).modulateScale(osc(2, 0.05)).contrast(1.3).out()`,
  },
  {
    name: 'Bass Bloom',
    code: `shape(99, () => 0.2 + a.fft[0]*0.5, 0.1).color(1, 0.42, 0.42).scale(() => 1 + a.fft[0]).out()`,
  },
  {
    name: 'Mid Mesh',
    code: `osc(20, 0.05, 1).kaleid(() => 3 + Math.floor(a.fft[2]*6)).color(1, 0.5, 0.4).modulate(noise(2)).rotate(() => time*0.1).out()`,
  },
];

/** Pick a different preset (random, avoiding the current one when possible). */
export function pickNextHydraPreset(current: string | null): HydraPreset {
  if (HYDRA_PRESETS.length === 1) return HYDRA_PRESETS[0];
  let next: HydraPreset;
  let tries = 0;
  do {
    next = HYDRA_PRESETS[Math.floor(Math.random() * HYDRA_PRESETS.length)];
    tries++;
  } while (next.name === current && tries < 8);
  return next;
}
