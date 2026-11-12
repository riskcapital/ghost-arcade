/**
 * How Analog Synth's controls read on a panel: the short legend under a knob
 * and the value it shows while turned. Shared by the tray and the full view.
 */
import { VIDEOSYNTH_PARAMS, type ParamSpec } from './patch';

export const paramSpec = (key: string): ParamSpec => VIDEOSYNTH_PARAMS.find((p) => p.key === key)!;

const hz = (v: number) => {
  const f = 60 * Math.pow(2, v * 10 - 2);
  return f >= 1000 ? `${(f / 1000).toFixed(2)} kHz` : `${f.toFixed(f < 100 ? 1 : 0)} Hz`;
};
const pct = (v: number) => `${Math.round(v * 100)}%`;
const signedPct = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`;

const FORMATS: Record<string, (v: number) => string> = {
  Freq: hz,
  Fine: (v) => `${v >= 0 ? '+' : ''}${(v * 2).toFixed(2)} Hz`,
  Sync: (v) => (v < 0.15 ? 'Free' : v < 0.85 ? 'Free–H' : v < 1.15 ? 'H' : v < 1.85 ? 'H–V' : 'V'),
  Shape: (v) => (v < 0.15 ? 'Saw' : v < 0.35 ? 'Saw–tri' : v < 0.65 ? 'Tri' : v < 0.85 ? 'Tri–sine' : 'Sine'),
  Hue: (v) => `${Math.round(v * 360)}°`,
  Amt: signedPct,
  vsRotate: (v) => `${Math.round(v)}°`,
  vsScale: (v) => `${v.toFixed(2)}×`,
  vsKaleido: (v) => (v < 1 ? 'Off' : `${Math.round(v)}`),
  vsFbZoom: (v) => `${((v - 1) * 100).toFixed(1)}%`,
  vsFbRotate: (v) => `${v.toFixed(1)}°`,
  vsFbX: (v) => (v * 100).toFixed(1),
  vsFbY: (v) => (v * 100).toFixed(1),
  vsX: (v) => v.toFixed(2),
  vsY: (v) => v.toFixed(2),
  Rate: (v) => {
    const f = 0.002 * Math.pow(5000, v);
    return f < 0.1 ? `${(1 / f).toFixed(0)} s` : `${f.toFixed(2)} Hz`;
  },
};

export function formatParam(p: ParamSpec): (v: number) => string {
  if (FORMATS[p.key]) return FORMATS[p.key];
  // A patch input's amount turns both ways.
  if (p.key.endsWith('Amt')) return signedPct;
  const tail = p.key.replace(/^vs[ABC](?=[A-Z])/, '').replace(/^vsLfo\d/, '');
  return FORMATS[tail] ?? pct;
}

const KNOB_LABELS: Record<string, string> = {
  Freq: 'Freq', Fine: 'Fine', Sync: 'Sync', Shape: 'Wave', Mod: 'Mod', Fm: 'FM', Hue: 'Color', Sat: 'Sat', Level: 'Level',
  vsX: 'Move X', vsY: 'Move Y', vsRotate: 'Rotate', vsScale: 'Scale', vsKaleido: 'Mirror',
  vsFeedback: 'Amount', vsFbZoom: 'Zoom', vsFbRotate: 'Turn', vsFbX: 'Drift X', vsFbY: 'Drift Y', vsFbHue: 'Color',
  vsLfo1Rate: 'Rate', vsLfo1Skew: 'Shape', vsLfo2Rate: 'Rate', vsLfo2Skew: 'Shape', vsLfo3Rate: 'Rate', vsLfo3Skew: 'Shape',
  vsScanlines: 'Lines', vsBleed: 'Bleed', vsRoll: 'Roll', vsGlow: 'Glow', vsReact: 'Follow',
};
export const knobLabel = (key: string) => KNOB_LABELS[key] ?? KNOB_LABELS[key.replace(/^vs[ABC]/, '')] ?? paramSpec(key).label;
