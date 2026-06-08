// Mobile-side effect chain — fragment-shader post-process passes that
// run after a layer's source shader. Each effect is a separate program
// that samples the previous pass's framebuffer texture (`uInput`) and
// writes the modified pixel.
//
// We deliberately share effect TYPE strings (e.g. `'rgbShift'`,
// `'kaleidoscope'`) and PARAM names (e.g. `'rgbShiftAmount'`) with the
// desktop catalog (src/lib/effects/effectParamDefs.ts) so the UI can
// pull slider definitions straight from `EFFECT_PARAM_DEFS` — no per-
// effect UI code on this side, and a user who knows the desktop names
// finds them here too.
//
// First-pass curated set (10) — picked for: (1) name recognition from
// desktop, (2) low GPU cost on phones, (3) visually distinct so each
// pull from the picker feels useful. More can be added later by
// appending entries.

export interface MobileEffectInstance {
  type: string;
  /** Param object keyed by EFFECT_PARAM_DEFS param names. */
  params: Record<string, number>;
  enabled: boolean;
}

export interface MobileEffectDef {
  /** Matches EFFECT_PARAM_DEFS key + EFFECT_CATALOG `type`. */
  type: string;
  /** Display label — copies desktop catalog labels for consistency. */
  label: string;
  /** Loose category tag for the picker accordion. */
  category: 'Color' | 'Stylize' | 'Distort' | 'Glitch' | 'Masking';
  /** GLSL fragment-shader body. Required varying: `vUv`. Required
   *  uniforms: `uInput` (sampler2D), `uResolution` (vec2), `uTime`
   *  (float). Plus whatever extras the param binder pushes. */
  fragment: string;
  /** Default param values keyed by EFFECT_PARAM_DEFS param names. */
  defaults: Record<string, number>;
}

const COMMON_PREAMBLE = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uInput;
uniform vec2 uResolution;
uniform float uTime;
`;

/** Wrap a custom main-body in the shared preamble. Body has access to
 *  `vec2 uv`, `vec4 c` (the source sample), and assigns to `gl_FragColor`. */
function wrapEffect(extraUniforms: string, body: string): string {
  return `${COMMON_PREAMBLE}
${extraUniforms}
void main() {
  vec2 uv = vUv;
  vec4 c = texture2D(uInput, uv);
  ${body}
}
`;
}

export const MOBILE_EFFECTS: MobileEffectDef[] = [
  {
    type: 'invert',
    label: 'Invert',
    category: 'Color',
    defaults: {},
    fragment: wrapEffect('', 'gl_FragColor = vec4(1.0 - c.rgb, c.a);'),
  },
  {
    type: 'posterize',
    label: 'Posterize',
    category: 'Color',
    defaults: { posterizeLevels: 4 },
    fragment: wrapEffect(
      'uniform float posterizeLevels;',
      `float L = max(2.0, posterizeLevels);
       vec3 q = floor(c.rgb * L) / L;
       gl_FragColor = vec4(q, c.a);`,
    ),
  },
  {
    type: 'rgbShift',
    label: 'RGB Shift',
    category: 'Glitch',
    defaults: { rgbShiftAmount: 0.4, rgbShiftAngle: 0 },
    fragment: wrapEffect(
      `uniform float rgbShiftAmount;
       uniform float rgbShiftAngle;`,
      `float ang = rgbShiftAngle * 6.2831853;
       vec2 dir = vec2(cos(ang), sin(ang)) * (rgbShiftAmount * 0.04);
       float r = texture2D(uInput, uv + dir).r;
       float g = c.g;
       float b = texture2D(uInput, uv - dir).b;
       gl_FragColor = vec4(r, g, b, c.a);`,
    ),
  },
  {
    type: 'pixelate',
    label: 'Pixelate',
    category: 'Stylize',
    defaults: { pixelateSize: 16 },
    fragment: wrapEffect(
      'uniform float pixelateSize;',
      `float sz = max(2.0, pixelateSize);
       vec2 cell = floor(uv * uResolution / sz) * sz / uResolution;
       gl_FragColor = texture2D(uInput, cell);`,
    ),
  },
  {
    type: 'kaleidoscope',
    label: 'Kaleidoscope',
    category: 'Distort',
    defaults: { kaleidoscopeSegments: 6, kaleidoscopeOffset: 0 },
    fragment: wrapEffect(
      `uniform float kaleidoscopeSegments;
       uniform float kaleidoscopeOffset;`,
      `vec2 p = uv - 0.5;
       float r = length(p);
       float a = atan(p.y, p.x) + kaleidoscopeOffset * 6.2831853;
       float seg = max(2.0, kaleidoscopeSegments);
       float wedge = 6.2831853 / seg;
       a = mod(a, wedge);
       a = abs(a - wedge * 0.5);
       vec2 q = vec2(cos(a), sin(a)) * r + 0.5;
       gl_FragColor = texture2D(uInput, q);`,
    ),
  },
  {
    type: 'mirror',
    label: 'Mirror',
    category: 'Distort',
    defaults: { mirrorAxis: 0 },
    fragment: wrapEffect(
      'uniform float mirrorAxis;',
      `// 0 = vertical (mirror left↔right), 1 = horizontal (top↔bottom).
       vec2 q = uv;
       if (mirrorAxis < 0.5) {
         q.x = q.x > 0.5 ? 1.0 - q.x : q.x;
       } else {
         q.y = q.y > 0.5 ? 1.0 - q.y : q.y;
       }
       gl_FragColor = texture2D(uInput, q);`,
    ),
  },
  {
    type: 'scanlines',
    label: 'Scanlines',
    category: 'Stylize',
    defaults: { scanlinesIntensity: 0.5, scanlinesCount: 240, scanlinesSpeed: 0.2 },
    fragment: wrapEffect(
      `uniform float scanlinesIntensity;
       uniform float scanlinesCount;
       uniform float scanlinesSpeed;`,
      `float line = sin((uv.y * scanlinesCount + uTime * scanlinesSpeed) * 3.14159);
       float bar  = 0.5 + 0.5 * line;
       vec3 col = c.rgb * mix(1.0, bar, scanlinesIntensity);
       gl_FragColor = vec4(col, c.a);`,
    ),
  },
  {
    type: 'chromaticAberration',
    label: 'Chromatic Aberration',
    category: 'Stylize',
    defaults: { chromaticAberrationAmount: 0.5 },
    fragment: wrapEffect(
      'uniform float chromaticAberrationAmount;',
      `vec2 p = uv - 0.5;
       float r2 = dot(p, p);
       float k = chromaticAberrationAmount * 0.05;
       vec2 dr = p * (1.0 + k *  r2);
       vec2 dg = p * (1.0 + 0.0      );
       vec2 db = p * (1.0 - k *  r2);
       float r = texture2D(uInput, dr + 0.5).r;
       float g = texture2D(uInput, dg + 0.5).g;
       float b = texture2D(uInput, db + 0.5).b;
       gl_FragColor = vec4(r, g, b, c.a);`,
    ),
  },
  {
    type: 'vignette',
    label: 'Vignette',
    category: 'Masking',
    defaults: { vignetteSize: 0.6, vignetteSoftness: 0.5 },
    fragment: wrapEffect(
      `uniform float vignetteSize;
       uniform float vignetteSoftness;`,
      `vec2 p = uv - 0.5;
       float r = length(p);
       float v = smoothstep(vignetteSize, vignetteSize - vignetteSoftness, r);
       gl_FragColor = vec4(c.rgb * v, c.a);`,
    ),
  },
  {
    type: 'filmGrain',
    label: 'Film Grain',
    category: 'Stylize',
    defaults: { filmGrainAmount: 0.3 },
    fragment: wrapEffect(
      'uniform float filmGrainAmount;',
      `float n = fract(sin(dot(uv * uResolution + uTime * 60.0, vec2(12.9898, 78.233))) * 43758.5453);
       float g = (n - 0.5) * filmGrainAmount * 0.6;
       gl_FragColor = vec4(c.rgb + g, c.a);`,
    ),
  },
];

export function findMobileEffect(type: string): MobileEffectDef | undefined {
  return MOBILE_EFFECTS.find(e => e.type === type);
}
