/**
 * Blend modes for deck layers and mapping surfaces: the desktop's ids, its renderer's codes and
 * its formulas (`native_blend` in the desktop renderer), so a set made on either side looks the
 * same on the other. The GLSL below and the reference functions are one port of that formula;
 * the compositor bench checks the GPU against the reference pixel by pixel.
 */
import type { BlendMode as DesktopBlendMode } from '../../types';

export type BlendMode = DesktopBlendMode;

/** The desktop renderer's code for each mode. The shader switches on these. */
export const BLEND_CODE: Readonly<Record<BlendMode, number>> = {
  normal: 0,
  add: 1,
  multiply: 2,
  screen: 3,
  overlay: 4,
  subtract: 5,
  difference: 6,
  lighten: 7,
  darken: 8,
  average: 9,
  hardlight: 10,
  softlight: 11,
  exclusion: 12,
  'color-dodge': 13,
  'color-burn': 14,
  hue: 15,
  saturation: 16,
  color: 17,
  luminosity: 18,
  divide: 19,
  negation: 20,
  phoenix: 21,
  'linear-light': 22,
  'hard-mix': 23,
  'vivid-light': 24,
  'pin-light': 25,
};

/** Every mode, in the desktop's menu order. */
export const BLEND_MODES: readonly BlendMode[] = [
  'normal', 'add', 'multiply', 'screen', 'overlay', 'difference', 'subtract', 'darken', 'lighten', 'exclusion',
  'hardlight', 'softlight', 'color-dodge', 'color-burn', 'hue', 'saturation', 'color', 'luminosity', 'divide',
  'average', 'negation', 'phoenix', 'linear-light', 'hard-mix', 'vivid-light', 'pin-light',
];

/** The five modes app 1.1 had. They run in the small shader, so a set that uses only these costs what it always did. */
export const BASIC_BLENDS: readonly BlendMode[] = ['normal', 'add', 'screen', 'multiply', 'difference'];
const BASIC_CODES = new Set(BASIC_BLENDS.map((m) => BLEND_CODE[m]));
/** True when a shader code runs in the small shader (negative codes are plain copies). */
export const basicBlendCode = (code: number) => code < 0 || BASIC_CODES.has(code);

export const isBlendMode = (value: unknown): value is BlendMode =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(BLEND_CODE, value);
/** A saved blend as this app can play it: unknown or missing is Normal. */
export const normalizeBlend = (value: unknown): BlendMode => (isBlendMode(value) ? value : 'normal');
/** The shader code for a saved blend; anything unknown is Normal. */
export const blendCode = (value: unknown): number => BLEND_CODE[normalizeBlend(value)];

/** Menu text, the same as the desktop's: 'color-dodge' -> 'Color dodge'. */
export function blendLabel(mode: BlendMode): string {
  const words = mode === 'hardlight' ? 'Hard light' : mode === 'softlight' ? 'Soft light' : mode.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** One plain line per mode, for someone who has never used one. "It" is the layer or surface being set. */
export const BLEND_DESCRIPTIONS: Readonly<Record<BlendMode, string>> = {
  normal: 'Covers what is beneath. Lower the opacity to see through it.',
  multiply: 'Darkens. White drops out and black stays black.',
  darken: 'Keeps the darker of the two at every point.',
  'color-burn': 'Darkens what is beneath into deep, rich shadows.',
  add: 'Adds the light together. Bright and punchy; can clip to white.',
  screen: 'Lightens. Black drops out, like two projectors on one wall.',
  lighten: 'Keeps the brighter of the two at every point.',
  'color-dodge': 'Brightens what is beneath into glowing highlights.',
  overlay: 'More contrast, led by the picture beneath.',
  softlight: 'Gentle contrast, like a soft light on what is beneath.',
  hardlight: 'Strong contrast, led by its own darks and lights.',
  'linear-light': 'Darkens or brightens hard, led by its own darks and lights.',
  'vivid-light': 'Burns the darks and brightens the lights. Very punchy.',
  'pin-light': 'Its darks and lights replace what is beneath; mid grey leaves it.',
  'hard-mix': 'Every color goes fully on or off: bold poster colors.',
  difference: 'Takes one from the other. Matching colors turn black.',
  exclusion: 'Like Difference, but softer and lower in contrast.',
  subtract: 'Takes its light away from what is beneath.',
  divide: 'Brightens what is beneath, most where it is dark.',
  negation: 'Adds like Add, but light past white folds back to dark.',
  phoenix: 'The opposite of Difference: matching colors turn white.',
  average: 'An even half-and-half mix of the two.',
  hue: 'Takes its hue; keeps the brightness and saturation beneath.',
  saturation: 'Takes its saturation; keeps the hue and brightness beneath.',
  color: 'Tints what is beneath with its hue and saturation.',
  luminosity: 'Takes its brightness; keeps the colors beneath.',
};

export type BlendGroup = { id: string; label: string; hint: string; modes: readonly BlendMode[] };
/** The picker's shelves. Every mode is on exactly one. */
export const BLEND_GROUPS: readonly BlendGroup[] = [
  { id: 'normal', label: 'Normal', hint: 'No mixing', modes: ['normal'] },
  { id: 'darken', label: 'Darken', hint: 'White drops out', modes: ['multiply', 'darken', 'color-burn'] },
  { id: 'lighten', label: 'Lighten', hint: 'Black drops out', modes: ['add', 'screen', 'lighten', 'color-dodge'] },
  { id: 'contrast', label: 'Contrast', hint: 'Darks darker, lights lighter', modes: ['overlay', 'softlight', 'hardlight', 'linear-light', 'vivid-light', 'pin-light', 'hard-mix'] },
  { id: 'difference', label: 'Difference', hint: 'Compares the two', modes: ['difference', 'exclusion', 'subtract', 'divide', 'negation', 'phoenix', 'average'] },
  { id: 'color', label: 'Color', hint: 'Mixes hue and brightness', modes: ['hue', 'saturation', 'color', 'luminosity'] },
];
export const blendGroupOf = (mode: BlendMode) => BLEND_GROUPS.find((g) => g.modes.includes(mode))!;

/**
 * GLSL ES 1.0 for the compositor: `vec3 blendColor(vec3 beneath, vec3 picture)` switching on the
 * `mode` uniform. With ALL_BLENDS defined, every mode, ported line by line from the desktop
 * renderer; without it, only the five of BASIC_BLENDS, exactly as app 1.1 drew them.
 */
export const BLEND_GLSL = `
#ifdef ALL_BLENDS
vec3 rgbToHsv(vec3 c){
 vec4 k=vec4(0.,-1./3.,2./3.,-1.);
 vec4 p=c.g>=c.b?vec4(c.gb,k.xy):vec4(c.bg,k.wz);
 vec4 q=c.r>=p.x?vec4(c.r,p.yzx):vec4(p.xyw,c.r);
 float d=q.x-min(q.w,q.y),e=1.0e-10;
 return vec3(abs(q.z+(q.w-q.y)/(6.*d+e)),d/(q.x+e),q.x);
}
vec3 hsvToRgb(vec3 c){
 vec4 k=vec4(1.,2./3.,1./3.,3.);
 vec3 p=abs(fract(c.xxx+k.xyz)*6.-k.www);
 return c.z*mix(k.xxx,clamp(p-k.xxx,0.,1.),c.y);
}
vec3 blendColor(vec3 beneath,vec3 picture){
 vec3 d=clamp(beneath,0.,1.5),s=clamp(picture,0.,1.5),one=vec3(1.);
 if(mode==1)return clamp(d+s,0.,1.);
 if(mode==2)return d*s;
 if(mode==3)return one-(one-d)*(one-s);
 if(mode==4)return mix(2.*d*s,one-2.*(one-d)*(one-s),vec3(greaterThan(d,vec3(.5))));
 if(mode==5)return max(d-s,0.);
 if(mode==6)return abs(d-s);
 if(mode==7)return max(d,s);
 if(mode==8)return min(d,s);
 if(mode==9)return (d+s)*.5;
 if(mode==10)return mix(2.*d*s,one-2.*(one-d)*(one-s),vec3(greaterThan(s,vec3(.5))));
 if(mode==11)return (one-2.*s)*d*d+2.*s*d;
 if(mode==12)return d+s-2.*d*s;
 if(mode==13)return clamp(d/max(one-s,vec3(.001)),0.,1.);
 if(mode==14)return clamp(one-(one-d)/max(s,vec3(.001)),0.,1.);
 if(mode>=15&&mode<=18){
  vec3 dh=rgbToHsv(clamp(d,0.,1.)),sh=rgbToHsv(clamp(s,0.,1.));
  if(mode==15)return hsvToRgb(vec3(sh.x,dh.y,dh.z));
  if(mode==16)return hsvToRgb(vec3(dh.x,sh.y,dh.z));
  if(mode==17)return hsvToRgb(vec3(sh.x,sh.y,dh.z));
  if(mode==18)return hsvToRgb(vec3(dh.x,dh.y,sh.z));
 }
 if(mode==19)return clamp(d/max(s,vec3(.001)),0.,1.);
 if(mode==20)return clamp(one-abs(one-d-s),0.,1.);
 if(mode==21)return clamp(min(d,s)-max(d,s)+one,0.,1.);
 if(mode==22)return clamp(d+2.*s-one,0.,1.);
 if(mode==23)return step(vec3(.5),clamp(d+2.*s-one,0.,1.));
 if(mode==24){
  vec3 burn=one-(one-d)/max(2.*s,vec3(.001)),dodge=d/max(2.*(one-s),vec3(.001));
  return clamp(mix(burn,dodge,vec3(greaterThanEqual(s,vec3(.5)))),0.,1.);
 }
 if(mode==25)return clamp(mix(min(d,2.*s),max(d,2.*s-one),vec3(greaterThanEqual(s,vec3(.5)))),0.,1.);
 return s;
}
#else
vec3 blendColor(vec3 d,vec3 s){
 if(mode==1)return min(d+s,1.);
 if(mode==3)return 1.-(1.-d)*(1.-s);
 if(mode==2)return d*s;
 if(mode==6)return abs(d-s);
 return s;
}
#endif
`;

export type RGB = readonly [number, number, number];
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const fract = (v: number) => v - Math.floor(v);

/** The desktop's rgb_to_hsv, as the shader runs it. */
export function rgbToHsv([r, g, b]: RGB): RGB {
  const k = [0, -1 / 3, 2 / 3, -1];
  const p = g >= b ? [g, b, k[0], k[1]] : [b, g, k[3], k[2]];
  const q = r >= p[0] ? [r, p[1], p[2], p[0]] : [p[0], p[1], p[3], r];
  const d = q[0] - Math.min(q[3], q[1]), e = 1e-10;
  return [Math.abs(q[2] + (q[3] - q[1]) / (6 * d + e)), d / (q[0] + e), q[0]];
}
/** The desktop's hsv_to_rgb. */
export function hsvToRgb([h, s, v]: RGB): RGB {
  const k = [1, 2 / 3, 1 / 3, 3];
  const ch = (offset: number) => {
    const p = Math.abs(fract(h + offset) * 6 - k[3]);
    return v * (k[0] * (1 - s) + clamp(p - k[0], 0, 1) * s);
  };
  return [ch(k[0]), ch(k[1]), ch(k[2])];
}

/** What `mode` makes of `picture` over `beneath`, before opacity: the desktop's native_blend. Channels 0..1. */
export function blendReference(mode: BlendMode, beneath: RGB, picture: RGB): RGB {
  const d = beneath.map((v) => clamp(v, 0, 1.5)) as unknown as RGB;
  const s = picture.map((v) => clamp(v, 0, 1.5)) as unknown as RGB;
  const each = (f: (d: number, s: number) => number): RGB => [f(d[0], s[0]), f(d[1], s[1]), f(d[2], s[2])];
  const c01 = (v: number) => clamp(v, 0, 1);
  switch (mode) {
    case 'add': return each((d, s) => c01(d + s));
    case 'multiply': return each((d, s) => d * s);
    case 'screen': return each((d, s) => 1 - (1 - d) * (1 - s));
    case 'overlay': return each((d, s) => (d > 0.5 ? 1 - 2 * (1 - d) * (1 - s) : 2 * d * s));
    case 'subtract': return each((d, s) => Math.max(d - s, 0));
    case 'difference': return each((d, s) => Math.abs(d - s));
    case 'lighten': return each(Math.max);
    case 'darken': return each(Math.min);
    case 'average': return each((d, s) => (d + s) * 0.5);
    case 'hardlight': return each((d, s) => (s > 0.5 ? 1 - 2 * (1 - d) * (1 - s) : 2 * d * s));
    case 'softlight': return each((d, s) => (1 - 2 * s) * d * d + 2 * s * d);
    case 'exclusion': return each((d, s) => d + s - 2 * d * s);
    case 'color-dodge': return each((d, s) => c01(d / Math.max(1 - s, 0.001)));
    case 'color-burn': return each((d, s) => c01(1 - (1 - d) / Math.max(s, 0.001)));
    case 'hue': case 'saturation': case 'color': case 'luminosity': {
      const dh = rgbToHsv(d.map(c01) as unknown as RGB), sh = rgbToHsv(s.map(c01) as unknown as RGB);
      if (mode === 'hue') return hsvToRgb([sh[0], dh[1], dh[2]]);
      if (mode === 'saturation') return hsvToRgb([dh[0], sh[1], dh[2]]);
      if (mode === 'color') return hsvToRgb([sh[0], sh[1], dh[2]]);
      return hsvToRgb([dh[0], dh[1], sh[2]]);
    }
    case 'divide': return each((d, s) => c01(d / Math.max(s, 0.001)));
    case 'negation': return each((d, s) => c01(1 - Math.abs(1 - d - s)));
    case 'phoenix': return each((d, s) => c01(Math.min(d, s) - Math.max(d, s) + 1));
    case 'linear-light': return each((d, s) => c01(d + 2 * s - 1));
    case 'hard-mix': return each((d, s) => (c01(d + 2 * s - 1) >= 0.5 ? 1 : 0));
    case 'vivid-light': return each((d, s) => c01(s >= 0.5 ? d / Math.max(2 * (1 - s), 0.001) : 1 - (1 - d) / Math.max(2 * s, 0.001)));
    case 'pin-light': return each((d, s) => c01(s >= 0.5 ? Math.max(d, 2 * s - 1) : Math.min(d, 2 * s)));
    default: return s;
  }
}

/**
 * The colour a layer or surface leaves: its blend over what is beneath, mixed in by its coverage
 * (picture alpha times opacity), over an opaque stack. The same rule as the desktop renderer.
 */
export function compositeReference(mode: BlendMode, beneath: RGB, picture: RGB, coverage: number): RGB {
  const a = clamp(coverage, 0, 1), blended = blendReference(mode, beneath, picture);
  return [0, 1, 2].map((i) => beneath[i] * (1 - a) + blended[i] * a) as unknown as RGB;
}

/** Size of a picker swatch, in pixels (drawn at twice this for sharp screens). */
export const SWATCH_SIZE = { width: 56, height: 36 } as const;
/**
 * A small picture of what the mode does: a sunset-like backdrop from dark (left) to light (right),
 * under a soft disc with cyan at the top and orange at the bottom. RGBA, rows top first.
 */
export function swatchPixels(mode: BlendMode, width: number = SWATCH_SIZE.width * 2, height: number = SWATCH_SIZE.height * 2): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(width * height * 4);
  const mixc = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const stops: RGB[] = [[0.02, 0.03, 0.1], [0.32, 0.12, 0.42], [0.86, 0.32, 0.3], [0.98, 0.78, 0.45], [1, 0.98, 0.9]];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const u = x / (width - 1), v = y / (height - 1);
      const t = u * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(t));
      const beneath = mixc(stops[i], stops[i + 1], t - i).map((c) => c * (0.82 + 0.18 * (1 - v))) as unknown as RGB;
      const dx = (u - 0.5) * (width / height), dy = v - 0.5, r = Math.hypot(dx, dy);
      const coverage = clamp((0.42 - r) / 0.05, 0, 1);
      const picture = mixc([0.1, 0.85, 0.95], [1, 0.55, 0.12], clamp(v * 1.2 - 0.1, 0, 1));
      const c = compositeReference(mode, beneath, picture, coverage);
      const o = (y * width + x) * 4;
      out[o] = Math.round(c[0] * 255); out[o + 1] = Math.round(c[1] * 255); out[o + 2] = Math.round(c[2] * 255); out[o + 3] = 255;
    }
  return out;
}

/** What a surface keeps of its picture: its opacity, 1 when it has none (every set saved before app 1.2). */
export const surfaceOpacity = (surface: { opacity?: number }) =>
  typeof surface.opacity === 'number' && Number.isFinite(surface.opacity) ? Math.min(1, Math.max(0, surface.opacity)) : 1;
/**
 * A saved surface's opacity and blend as they are kept: only when they differ from full and
 * Normal, so a set that never used them saves exactly as before and an older app reads it unchanged.
 */
export function normalizeSurfaceMix(raw: { opacity?: unknown; blend?: unknown }): { opacity?: number; blend?: BlendMode } {
  const out: { opacity?: number; blend?: BlendMode } = {};
  if (typeof raw.opacity === 'number' && Number.isFinite(raw.opacity) && raw.opacity < 1) out.opacity = Math.max(0, raw.opacity);
  if (isBlendMode(raw.blend) && raw.blend !== 'normal') out.blend = raw.blend;
  return out;
}
