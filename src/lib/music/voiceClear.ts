/**
 * A transparent background for any visual voice.
 *
 * With it on, a voice draws only its subject and the background is see-through,
 * so voices stack like drawings on acetate (ordinary source-over, no screen or
 * add): the one on top hides what is under its shapes and shows it through its
 * empty space.
 *
 * Voices made for it declare a `vxClear` input and draw real coverage alpha
 * themselves. The older voices draw light on black, so for them the studio
 * adds the input and keys the black out: a pixel's alpha follows its
 * brightness, faint light is lifted so thin lines still read, and the output
 * stays premultiplied (colour never above alpha), which is what the mix expects.
 */

export const VOICE_CLEAR_INPUT = 'vxClear';

const CLEAR_INPUT = { NAME: VOICE_CLEAR_INPUT, LABEL: 'Transparent background', TYPE: 'bool', DEFAULT: false };

/** True when a voice's own code handles the transparent background. */
export function declaresClear(code: string): boolean {
  return /"NAME"\s*:\s*"vxClear"/.test(code);
}

/**
 * The voice's code with a transparent-background option: unchanged when it
 * has its own, otherwise wrapped so its last pass keys black to transparent.
 * Anything it cannot parse comes back as it was.
 */
export function withClearOption(code: string): string {
  if (declaresClear(code)) return code;
  const open = code.indexOf('/*');
  const close = code.indexOf('*/', open + 2);
  if (open < 0 || close < 0) return code;
  let meta: { INPUTS?: unknown[]; PASSES?: unknown[] };
  try {
    meta = JSON.parse(code.slice(open + 2, close));
  } catch {
    return code;
  }
  const main = /\bvoid\s+main\s*\(\s*(?:void\s*)?\)/;
  const body = code.slice(close + 2);
  if (!main.test(body)) return code;
  meta.INPUTS = [...(Array.isArray(meta.INPUTS) ? meta.INPUTS : []), CLEAR_INPUT];
  const passes = Array.isArray(meta.PASSES) && meta.PASSES.length > 1 ? meta.PASSES.length : 1;
  const lastPass = passes > 1 ? ` && PASSINDEX == ${passes - 1}` : '';
  return `/*${JSON.stringify(meta, null, 4)}*/${body.replace(main, 'void vxDrawMain()')}

// Transparent background: black keys out, brightness becomes coverage.
void main() {
    vxDrawMain();
    if (vxClear${lastPass}) {
        vec4 vxSrc = gl_FragColor;
        float vxLum = max(max(vxSrc.r, vxSrc.g), vxSrc.b);
        float vxCover = smoothstep(0.015, 0.22, vxLum) * clamp(vxSrc.a, 0.0, 1.0);
        // Faint light keeps its hue at a lifted brightness, so thin lines still
        // read as a drawing: straight colour = c / sqrt(lum), premultiplied.
        vec3 vxLit = vxSrc.rgb / sqrt(max(vxLum, 0.0001));
        gl_FragColor = vec4(min(vxLit * vxCover, vec3(vxCover)), vxCover);
    }
}
`;
}
