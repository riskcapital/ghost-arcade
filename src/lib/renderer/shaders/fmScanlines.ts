// FM Lines — luminance-driven line-displacement portrait effect.
//
// A grid of lines is pushed off its baseline by two things added together:
// the BRIGHTNESS of the source at each point, and an animated sine wave.
// The "frequency modulation" part is that brightness ALSO drives the wave's
// frequency and amplitude — so lit areas (a face) churn into dense, fast,
// high-amplitude ripples while dark areas stay calm. The portrait emerges
// from the line density alone (white-on-black by default; composite with an
// additive/screen blend to drop the black). Horizontal, vertical, or
// concentric (polar rings) layouts.
//
// Reads the layer's own texture (uTexture) as the displacement source, so it
// works over any image, video, or shader content.

export const fmScanlinesShader = /* glsl */ `
precision highp float;

uniform sampler2D uTexture;   // layer content (image / video / shader)
uniform vec2 uResolution;
uniform float uTime;

uniform float uMode;       // 0 = horizontal, 1 = vertical, 2 = concentric
uniform float uCount;      // number of lines (density)
uniform float uWidth;      // line thickness 0..1
uniform float uFreq;       // base wave frequency 0..1
uniform float uFmDepth;    // brightness -> frequency 0..1  (the "FM")
uniform float uAmp;        // brightness -> amplitude  0..1
uniform float uSpeed;      // animation speed 0..2
uniform float uColorMix;   // 0 = white lines, 1 = source-tinted lines
uniform float uInvert;     // 0 = bright lines on black, 1 = dark lines on field

varying vec2 vUv;

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

void main() {
  vec2 uv = vUv;
  vec4 srcRGBA = texture2D(uTexture, uv);
  vec3 src = srcRGBA.rgb;
  float lum = luma(src);

  float numLines = max(4.0, uCount);
  float spacing = 1.0 / numLines;

  // Brightness modulates BOTH the wave frequency (the "FM") and its
  // amplitude. Amplitude is expressed in units of line-spacing so the look
  // stays coherent at any density.
  float baseFreq = uFreq * 40.0;
  float freq = baseFreq + lum * uFmDepth * 140.0;
  float amp  = spacing * (0.25 + lum * uAmp * 6.0);
  float phase = uTime * uSpeed * 3.0;

  // 'coord' is sampled across the lines; 'along' runs along each line and
  // carries the travelling wave.
  float coord, along;
  if (uMode < 0.5) {            // horizontal lines, displaced vertically
    coord = uv.y;
    along = uv.x;
  } else if (uMode < 1.5) {     // vertical lines, displaced horizontally
    coord = uv.x;
    along = uv.y;
  } else {                      // concentric rings, displaced radially
    vec2 c = uv - 0.5;
    c.x *= uResolution.x / max(uResolution.y, 1.0);  // keep circles round
    coord = length(c) * 1.4;
    along = coord;             // radial wave — seam-free (no atan wrap)
  }

  float disp = sin(along * freq + phase) * amp;
  float linePos = (coord + disp) * numLines;
  float tri = abs(fract(linePos) - 0.5);            // 0 at a line centre

  // Thickness: higher uWidth = thicker lines. Soft edges = cheap AA.
  float w = mix(0.04, 0.5, clamp(uWidth, 0.0, 1.0));
  float lineMask = 1.0 - smoothstep(w * 0.6, w, tri);

  vec3 lineCol = mix(vec3(1.0), src, clamp(uColorMix, 0.0, 1.0));

  bool inv = uInvert > 0.5;
  vec3 col = inv ? lineCol * (1.0 - lineMask) : lineCol * lineMask;
  // Non-invert: transparent gaps (lines only) so it composites cleanly.
  // Invert: solid field with dark lines cut out.
  float a = inv ? srcRGBA.a : lineMask * srcRGBA.a;

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), clamp(a, 0.0, 1.0));
}
`;
