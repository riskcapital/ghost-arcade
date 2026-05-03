/**
 * VJ A/B crossfader transition shader library.
 *
 * Each transition is a tiny GLSL fragment shader that samples two textures
 * (Bank A / Bank B) and a 0..1 mix value, producing the composited frame.
 *
 * Design rule: the MIDPOINT of every transition is its peak visual moment.
 * Park the fader at 0.5 and you get a deliberate, useful aesthetic — not a
 * muddy 50/50 blend. That's the whole point of having ten of these instead
 * of one dissolve.
 *
 * All shaders share the same uniform names:
 *   uniform sampler2D tBankA;     // bank A composite texture
 *   uniform sampler2D tBankB;     // bank B composite texture
 *   uniform float uMix;            // 0..1, post-curve fader value
 *   uniform float uTime;           // seconds, for transitions that need motion
 *   uniform vec2  uRes;            // render target size in pixels
 *   varying vec2 vUv;             // [0,1] uv from full-screen quad
 *
 * The engine wires these uniforms once per shader; transitions just use them.
 *
 * To add a new transition: create a new entry in TRANSITIONS, append the
 * name to CrossfaderTransition in vjClipLauncher.ts, and (optionally) add
 * an icon entry in the UI. No engine changes needed.
 */

export interface TransitionDef {
  /** Stable id used in store + UI. */
  name: string;
  /** Human label for the selector menu. */
  label: string;
  /** Single-line description shown on hover. */
  description: string;
  /** Fragment-shader body — header + uniforms supplied by the engine. */
  fragment: string;
}

// Common header injected at the top of every shader so we don't repeat it.
// Includes uniforms, the bank samplers, and shared helper functions
// (hash / vnoise) used by multiple transitions. These MUST live at the
// top level — GLSL ES 1.00 forbids nested function definitions, so any
// helpers a transition needs have to be declared here, not inside main().
//
// uBlendMode (int) selects the A↔B math at the mix point. 0 = normal
// (use the transition shader's output verbatim). Any other value picks
// a per-component math (multiply/screen/add/etc.) and the BLEND_TAIL
// below sweeps the output A → blend(A,B) → B as uMix moves 0 → 0.5 → 1.
const SHARED_HEADER = `
precision highp float;
varying vec2 vUv;
uniform sampler2D tBankA;
uniform sampler2D tBankB;
uniform float uMix;
uniform float uTime;
uniform vec2  uRes;
uniform int   uBlendMode;

vec4 sampleA(vec2 uv) { return texture2D(tBankA, uv); }
vec4 sampleB(vec2 uv) { return texture2D(tBankB, uv); }

float xfHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float xfNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(xfHash(i), xfHash(i + vec2(1.0, 0.0)), f.x),
             mix(xfHash(i + vec2(0.0, 1.0)), xfHash(i + vec2(1.0, 1.0)), f.x), f.y);
}

// Per-channel blend math. Mirrors the canonical Photoshop-style modes
// the layer compositing path uses, scoped to a single fragment so it
// runs cheap inside the crossfade quad. Caller picks between these via
// uBlendMode and we sweep A → blended → B as the fader crosses 0..1.
vec3 xfBlend(vec3 a, vec3 b, int mode) {
  if (mode == 1) return a * b;                             // multiply
  if (mode == 2) return 1.0 - (1.0 - a) * (1.0 - b);       // screen
  if (mode == 3) return min(a + b, vec3(1.0));             // add (clamped)
  if (mode == 4) return abs(a - b);                        // difference
  if (mode == 5) return min(a, b);                         // darken
  if (mode == 6) return max(a, b);                         // lighten
  if (mode == 7) {                                          // overlay
    vec3 lo = 2.0 * a * b;
    vec3 hi = 1.0 - 2.0 * (1.0 - a) * (1.0 - b);
    return mix(lo, hi, step(vec3(0.5), a));
  }
  if (mode == 8) return a + b - 2.0 * a * b;               // exclusion
  return mix(a, b, 0.5);                                   // fallback (unused; mode==0 short-circuits)
}
`;

/** Wrap a transition's main() body in the shared header + a void main entry.
 *  The body must NOT declare functions — put helpers in SHARED_HEADER.
 *
 *  Dead-zone tail: every transition gets a small (~2%) blend zone at each
 *  end of the fader where the output smoothly returns to PURE A (uMix=0)
 *  or PURE B (uMix=1). Without this, several transitions leak artifacts
 *  even at the extremes:
 *    - WIPE has a 6% diagonal that crosses the screen edge — at uMix=0
 *      a small sliver of B shows in the bottom-left corner; at uMix=1
 *      a sliver of A shows in the top-right.
 *    - SLIDE draws a 1.8% bright seam at the slide edge that's still
 *      visible at fully-A and fully-B.
 *    - SHATTER draws cell-edge "cracks" (dark grid) over A even when no
 *      cells have moved.
 *    - GLITCH per-block hash sometimes flips a block to B at uMix=0
 *      due to floating-point hash hitting near-zero values.
 *  Operators expect "fader at top = clean A, fader at bottom = clean B"
 *  with no audience-visible artifacts at the endpoints; the dead zone
 *  enforces that without changing the deliberate midpoint aesthetic. */
const DEAD_ZONE_TAIL = `
  // Smoothly snap to pure A / pure B inside the 2% dead zone at each
  // end. smoothstep gives a gentle ramp instead of a hard cut so the
  // operator can't see the artifacts retract — they're just gone.
  const float DEAD_ZONE = 0.02;
  if (uMix < DEAD_ZONE) {
    float t = smoothstep(0.0, DEAD_ZONE, uMix);
    gl_FragColor = mix(sampleA(vUv), gl_FragColor, t);
  } else if (uMix > 1.0 - DEAD_ZONE) {
    float t = smoothstep(1.0 - DEAD_ZONE, 1.0, uMix);
    gl_FragColor = mix(gl_FragColor, sampleB(vUv), t);
  }
`;
// When a non-normal blend mode is selected, MIX the transition shader's
// gl_FragColor with the per-pixel blend equation in the "overlap zone"
// — the region of the fader where both A and B are contributing. This
// preserves the transition's spatial journey (wipe, glitch shards,
// dissolve noise, etc.) and tints the visible mixed pixels with the
// chosen blend math (multiply, screen, add, etc.). At fader extremes
// the overlap factor is 0 so the transition output passes through
// unchanged — combined with the DEAD_ZONE_TAIL below, uMix=0 always
// gives pure A and uMix=1 always gives pure B regardless of blend mode.
//
// Earlier impl REPLACED the transition output entirely when blend mode
// != normal — operator complaint: "options must be identical and work.
// both transition and blend mode at the same time." This version honors
// both: pick "glitch + multiply" → glitch shards rendered with multiply
// blend at the midpoint; pick "dissolve + screen" → noise dissolve
// rendered with screen blend, etc.
const BLEND_TAIL = `
  if (uBlendMode != 0) {
    vec3 a = sampleA(vUv).rgb;
    vec3 b = sampleB(vUv).rgb;
    vec3 blended = xfBlend(a, b, uBlendMode);
    // Overlap factor: 1 at uMix=0.5 (peak A+B mix), 0 at extremes.
    // Triangular envelope so the blend tint fades in / out smoothly
    // across the fader rather than popping in.
    float overlap = 1.0 - abs(uMix - 0.5) * 2.0;
    gl_FragColor = vec4(mix(gl_FragColor.rgb, blended, overlap), gl_FragColor.a);
  }
`;
function buildShader(body: string): string {
  return `${SHARED_HEADER}\nvoid main() {\n${body}\n${BLEND_TAIL}\n${DEAD_ZONE_TAIL}\n}`;
}

// ─── 01 · DISSOLVE ────────────────────────────────────────────────────
// The boring baseline. Constant-power crossfade so 50/50 doesn't dip in
// luminance vs full A or full B (linear blend has a noticeable "valley").
const DISSOLVE = buildShader(`
  vec4 a = sampleA(vUv);
  vec4 b = sampleB(vUv);
  float ka = cos(uMix * 1.5707963);  // = sqrt(1 - uMix) curve
  float kb = sin(uMix * 1.5707963);
  gl_FragColor = a * ka + b * kb;
`);

// ─── 02 · HARD WIPE ───────────────────────────────────────────────────
// Hard diagonal line cuts L→R. At midpoint, the screen is split exactly
// in half: A on the left, B on the right. Looks devastating with the
// geometric pack on each side.
const WIPE = buildShader(`
  // 0..1 wipe position
  float pos = uMix;
  // Slight diagonal so the wipe edge has more visual interest than a vertical line.
  float wipeAt = pos + (vUv.y - 0.5) * 0.06;
  float side = step(vUv.x, wipeAt);
  gl_FragColor = mix(sampleB(vUv), sampleA(vUv), 1.0 - side);
`);

// ─── 03 · RGB SPLIT ───────────────────────────────────────────────────
// Chromatic aberration during the transition. At midpoint, R/G/B channels
// are maximally separated horizontally — the midpoint look is a
// psychedelic "broken cable" frame, ON PURPOSE. Park there.
const RGB_SPLIT = buildShader(`
  // Triangle wave: 0 at the ends, 1 at midpoint
  float intensity = 1.0 - abs(2.0 * uMix - 1.0);
  float offset = intensity * 0.04;  // peak ~4% of screen width

  // Channel-shifted samples of A and B individually, then crossfaded
  vec4 a;
  a.r = sampleA(vUv + vec2(-offset, 0.0)).r;
  a.g = sampleA(vUv).g;
  a.b = sampleA(vUv + vec2( offset, 0.0)).b;
  a.a = 1.0;

  vec4 b;
  b.r = sampleB(vUv + vec2(-offset, 0.0)).r;
  b.g = sampleB(vUv).g;
  b.b = sampleB(vUv + vec2( offset, 0.0)).b;
  b.a = 1.0;

  gl_FragColor = mix(a, b, smoothstep(0.0, 1.0, uMix));
`);

// ─── 04 · CUBE ROTATE ─────────────────────────────────────────────────
// Banks live on adjacent faces of a cube; the cube rotates 90° from A to B
// around the vertical axis. At midpoint, it's edge-on — A occupies the
// left half compressed by perspective, B the right half. Perfect "hinge"
// moment.
//
// Math: cylinder approximation — sample A from a horizontally compressed
// region on the left, B from a compressed region on the right, with a
// fake highlight at the seam to suggest the cube edge.
const CUBE = buildShader(`
  float angle = uMix * 1.5707963;  // 0..π/2
  float ca = cos(angle);
  float sa = sin(angle);

  // Map screen x [0,1] → world x in cube view space [-1,1]
  float x = vUv.x * 2.0 - 1.0;
  float y = vUv.y;

  // Two faces of a cube: face A (front) at z=1, face B (right) at z=1
  // after a 90° rotation. We project both onto the viewport and pick
  // whichever is "facing the camera" at this pixel.

  // Face A unrotated normal (0,0,1) — visible when we look from x<edge
  // Face B unrotated normal (1,0,0) → after rotating by -angle around y,
  // becomes (cos,0,-sin). Visible when its projected x is on the right.

  // Edge x in screen space at this rotation: where the two faces meet.
  // Face A's right edge is at world x=1, projected x = ca after rotation.
  // Face B's left edge is at world x=1 (its own coord), projected to right.
  float edgeX = ca * 2.0 - 1.0; // matches the seam

  if (x < edgeX) {
    // Sample A — un-shrink the projection
    float u = (x + 1.0) / (edgeX + 1.0);
    // Tiny shading to suggest the cube face curving away
    float shade = mix(1.0, 0.65, smoothstep(0.6, 1.0, u));
    gl_FragColor = sampleA(vec2(u, y)) * shade;
  } else {
    // Sample B
    float u = (x - edgeX) / (1.0 - edgeX);
    float shade = mix(0.65, 1.0, smoothstep(0.0, 0.4, u));
    gl_FragColor = sampleB(vec2(u, y)) * shade;
  }

  // Bright seam line right at the cube edge for definition
  float dist = abs(x - edgeX);
  float seam = smoothstep(0.012, 0.0, dist);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0), seam * 0.45);
`);

// ─── 05 · SHATTER ─────────────────────────────────────────────────────
// Pseudo-Voronoi shatter: A breaks into chunks that fly outward as B is
// revealed underneath. At midpoint, MAX explosion — half-fragments
// scattered, B visible through the gaps.
//
// Implementation: pixel-grid cells (Voronoi-lite for cheap on-GPU cost),
// each cell offset by a randomized direction proportional to mix. Cells
// past their "fall time" are gone.
const SHATTER = buildShader(`
  // Shatter into ~12x7 cells
  vec2 cellSize = vec2(1.0 / 12.0, 1.0 / 7.0);
  vec2 cellId = floor(vUv / cellSize);
  vec2 cellUV = fract(vUv / cellSize);

  // Per-cell direction + per-cell delay (later-shattering cells revealed last)
  float delay = xfHash(cellId) * 0.4;
  float local = clamp((uMix - delay) / (1.0 - delay), 0.0, 1.0);

  // Each cell drifts in a randomized direction
  vec2 dir = normalize(vec2(xfHash(cellId + 1.7) - 0.5, xfHash(cellId + 3.3) - 0.5));
  // Plus a downward bias as if gravity pulled fragments
  dir.y -= 0.6;
  vec2 cellOffset = dir * local * 0.55;

  // Sample A at the shifted cell location (clamped UV — past edges = transparent fragment)
  vec2 sampleUv = vUv - cellOffset;
  vec4 a = sampleA(sampleUv);

  // Fade each fragment out near its lifetime end so they vanish into B
  float aAlpha = 1.0 - smoothstep(0.7, 1.0, local);
  // Mask off fragments whose cell has fully fallen off-screen
  if (sampleUv.x < 0.0 || sampleUv.x > 1.0 || sampleUv.y < 0.0 || sampleUv.y > 1.0) aAlpha = 0.0;

  vec4 b = sampleB(vUv);
  // Cell-edge "crack" line — thin dark border on each shard for definition
  vec2 edgeDist = min(cellUV, 1.0 - cellUV);
  float crack = smoothstep(0.04, 0.0, min(edgeDist.x, edgeDist.y));
  a.rgb = mix(a.rgb, vec3(0.0), crack * aAlpha * 0.55);

  gl_FragColor = mix(b, a, aAlpha);
`);

// ─── 06 · HALFTONE ────────────────────────────────────────────────────
// Pop-art reveal: A is dissolved into a polka-dot pattern of B. At midpoint,
// max dot density — the screen looks like a Lichtenstein print mixing both.
const HALFTONE = buildShader(`
  // Dot density that peaks at midpoint then falls away (so endpoints are clean)
  float density = 1.0 - abs(uMix - 0.5) * 2.0; // triangle 0..1..0

  // Radius of each dot — bigger = more B revealed
  float dotR = 0.6 + uMix * 0.5;

  vec2 grid = fract(vUv * 70.0) - 0.5;
  float d = length(grid);
  // Inside-dot mask: dot grows with density
  float dotMask = smoothstep(0.5 * dotR + 0.05, 0.5 * dotR - 0.05, d);
  // Modulate by density so endpoints converge to plain B/A
  dotMask *= density;

  // Outside dots: cross-fade from A to B by raw uMix as a base layer
  vec4 base = mix(sampleA(vUv), sampleB(vUv), uMix);
  // Dots themselves show B (so as A "halftones away", B leaks through dot holes)
  vec4 dotColor = sampleB(vUv);

  gl_FragColor = mix(base, dotColor, dotMask);
`);

// ─── 07 · GLITCH ──────────────────────────────────────────────────────
// Datamosh-style block scramble. At midpoint, MAX scramble — the screen is
// fully blocky and chaotic, mixing displaced chunks of A and B.
const GLITCH = buildShader(`
  // Scramble peaks at midpoint
  float intensity = 1.0 - abs(2.0 * uMix - 1.0);

  // Block grid — coarser at peak intensity (more visible chunks)
  float blockSize = mix(80.0, 22.0, intensity);
  vec2 block = floor(vUv * blockSize);

  // Per-block horizontal jitter (keyed to time so it skitters)
  float r = xfHash(block + floor(uTime * 12.0));
  float shift = (r - 0.5) * intensity * 0.18;

  // Per-block vertical channel-roll
  float vshift = (xfHash(block + 7.7) - 0.5) * intensity * 0.05;

  vec2 sampleUv = vUv + vec2(shift, vshift);

  // Pick A or B per-block, weighted by uMix — peak intensity → 50/50
  float pickB = step(xfHash(block + 13.13), uMix);
  vec4 sa = sampleA(sampleUv);
  vec4 sb = sampleB(sampleUv);
  vec4 col = mix(sa, sb, pickB);

  // Color channel split per-block at peak intensity for extra glitch flavour
  if (intensity > 0.5) {
    float pickRedB  = step(xfHash(block + 23.7), uMix);
    float pickBlueB = step(xfHash(block + 41.1), uMix);
    col.r = mix(sa.r, sb.r, pickRedB);
    col.b = mix(sa.b, sb.b, pickBlueB);
  }

  gl_FragColor = col;
`);

// ─── 08 · LIQUID ──────────────────────────────────────────────────────
// Noise-displaced flow morph. At midpoint, the displacement is maximum,
// creating a swirling "liquid pool" of A and B mixed. Uses cheap value
// noise so it stays performant.
const LIQUID = buildShader(`
  float intensity = 1.0 - abs(2.0 * uMix - 1.0);
  float disp = intensity * 0.09;

  // Animated flow-field offset — each pixel pulled along noise gradient
  vec2 nUV = vUv * 4.0 + uTime * 0.12;
  float n1 = xfNoise(nUV);
  float n2 = xfNoise(nUV + 13.7);
  vec2 offset = vec2(n1 - 0.5, n2 - 0.5) * disp;

  vec4 a = sampleA(vUv + offset);
  vec4 b = sampleB(vUv - offset);

  gl_FragColor = mix(a, b, smoothstep(0.0, 1.0, uMix));
`);

// ─── 09 · STROBE MIX ──────────────────────────────────────────────────
// Rapidly alternates between A and B — frequency peaks at midpoint.
// At the endpoints (uMix → 0 or 1) the strobe slows to nothing. Hard cuts
// only — no fade — so it reads as STROBE not as motion blur.
const STROBE = buildShader(`
  float intensity = 1.0 - abs(2.0 * uMix - 1.0);  // 0..1..0
  // Strobe rate scales from 2hz at edges to ~24hz at midpoint
  float rate = 2.0 + intensity * 22.0;
  float phase = fract(uTime * rate);
  // Duty biased by uMix so endpoints converge to all-A / all-B
  float pickB = step(uMix, phase);
  // Below: pickB=1 → show B. Above: pickB=0 → show A.
  // Wait, that's inverted — fix:
  float showA = step(phase, 1.0 - uMix);
  gl_FragColor = mix(sampleB(vUv), sampleA(vUv), showA);
`);

// ─── 10 · SLIDE ───────────────────────────────────────────────────────
// A slides off to the left as B slides in from the right. At midpoint,
// both occupy half the screen width with a hard seam between them. Like
// a kinetic wipe — direction has motion baked in.
const SLIDE = buildShader(`
  // Both banks shift horizontally — A by -uMix, B by (1-uMix)
  float aShift = uMix;
  float bShift = uMix - 1.0;

  vec2 aUv = vUv + vec2(aShift, 0.0);
  vec2 bUv = vUv + vec2(bShift, 0.0);

  // Pixel mask: which bank's region of the screen we're in
  bool inA = aUv.x >= 0.0 && aUv.x <= 1.0;
  bool inB = bUv.x >= 0.0 && bUv.x <= 1.0;

  vec4 col = vec4(0.0, 0.0, 0.0, 1.0);
  if (inA && !inB) col = sampleA(aUv);
  else if (inB && !inA) col = sampleB(bUv);
  else if (inA && inB) {
    // Overlap region (briefly during transition) — favor B since it's incoming
    col = sampleB(bUv);
  }

  // Bright seam at the slide edge
  float seamA = smoothstep(0.018, 0.0, aUv.x); // left edge of A
  float seamB = smoothstep(0.018, 0.0, 1.0 - bUv.x); // right edge of B
  col.rgb = mix(col.rgb, vec3(1.0), max(seamA, seamB) * 0.4);

  gl_FragColor = col;
`);

// ─── REGISTRY ─────────────────────────────────────────────────────────
//
// Order here = order shown in the UI cycle. New transitions appended at
// the end. Names must match the CrossfaderTransition union in
// vjClipLauncher.ts.

export const TRANSITIONS: TransitionDef[] = [
  { name: 'dissolve',  label: 'Dissolve',   description: 'Constant-power crossfade. Clean 50/50 at midpoint.', fragment: DISSOLVE },
  { name: 'wipe',      label: 'Hard Wipe',  description: 'Diagonal line wipe. Midpoint = 50/50 split screen.', fragment: WIPE },
  { name: 'rgb-split', label: 'RGB Split',  description: 'Chromatic aberration peaks at midpoint.', fragment: RGB_SPLIT },
  { name: 'cube',      label: 'Cube',       description: '3D cube rotates A → B. Edge-on at midpoint.', fragment: CUBE },
  { name: 'shatter',   label: 'Shatter',    description: 'A breaks into shards revealing B. Max explosion midpoint.', fragment: SHATTER },
  { name: 'halftone',  label: 'Halftone',   description: 'Pop-art dot pattern. Peak dots midpoint.', fragment: HALFTONE },
  { name: 'glitch',    label: 'Glitch',     description: 'Block-shifted datamosh. Peak chaos midpoint.', fragment: GLITCH },
  { name: 'liquid',    label: 'Liquid',     description: 'Noise-driven displacement morph.', fragment: LIQUID },
  { name: 'strobe',    label: 'Strobe Mix', description: 'Rapid A/B alternation. Fastest at midpoint.', fragment: STROBE },
  { name: 'slide',     label: 'Slide',      description: 'A slides off, B slides in. 50/50 split midpoint.', fragment: SLIDE },
];

export function getTransition(name: string): TransitionDef {
  return TRANSITIONS.find(t => t.name === name) || TRANSITIONS[0];
}

/** Apply a fader curve to the raw 0..1 user value. Constant-power keeps
 *  perceived loudness flat across the sweep (no luminance valley at 0.5). */
export function applyFaderCurve(value: number, curve: 'linear' | 'constant-power' | 'sharp-cut'): number {
  const v = Math.max(0, Math.min(1, value));
  switch (curve) {
    case 'linear': return v;
    case 'constant-power':
      // Equal-power crossfade response — passes through unchanged for the
      // mix shader (each transition handles its own mix curve). Provided
      // here for callers that want a pre-shaped value, e.g. for displaying
      // perceived position on the UI.
      return Math.sin(v * Math.PI / 2);
    case 'sharp-cut':
      // S-curve: stays near 0 then near 1, with a fast traversal in the middle.
      return v < 0.5
        ? 0.5 * Math.pow(2 * v, 4)
        : 1 - 0.5 * Math.pow(2 * (1 - v), 4);
  }
}
