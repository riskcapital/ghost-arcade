// Pro Pack Shader - 32 modes for color, blur, keying, and distort effects

export const proPackShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uMode;
  uniform float uAmount;
  uniform float uAmount2;
  uniform float uAmount3;
  uniform float uThreshold;
  uniform float uAngle;
  uniform vec2 uCenter;
  uniform vec3 uColor;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

  vec4 sampleDir(vec2 uv, vec2 dir, float radius) {
    vec4 acc = vec4(0.0);
    float w = 0.0;
    for (int i = -6; i <= 6; i++) {
      float t = float(i) / 6.0;
      float ww = 1.0 - abs(t);
      acc += texture2D(uTexture, uv + dir * t * radius) * ww;
      w += ww;
    }
    return acc / max(w, 0.0001);
  }

  void main() {
    vec2 uv = vUv;
    vec2 px = 1.0 / max(uResolution, vec2(1.0));
    vec4 src = texture2D(uTexture, uv);
    vec4 outColor = src;
    int mode = int(uMode + 0.5);

    if (mode == 0) { // exposure
      outColor.rgb = src.rgb * exp2(uAmount * 4.0 - 2.0);
    } else if (mode == 1) { // gamma
      outColor.rgb = pow(max(src.rgb, vec3(0.0)), vec3(max(0.05, mix(0.2, 3.0, uAmount))));
    } else if (mode == 2) { // vibrance
      float mx = max(max(src.r, src.g), src.b);
      float mn = min(min(src.r, src.g), src.b);
      float sat = mx - mn;
      outColor.rgb = mix(src.rgb, vec3(mx), -sat * (uAmount * 2.0 - 1.0));
    } else if (mode == 3) { // temperature/tint
      outColor.rgb = src.rgb + vec3((uAmount - 0.5) * 0.4, (uAmount2 - 0.5) * 0.2, -(uAmount - 0.5) * 0.4);
    } else if (mode == 4) { // film grain
      float n = fract(sin(dot(uv * uResolution + uTime, vec2(12.9898, 78.233))) * 43758.5453);
      outColor.rgb = src.rgb + (n - 0.5) * uAmount;
    } else if (mode == 5) { // chromatic aberration
      vec2 d = uv - uCenter;
      vec2 off = normalize(d + 1e-6) * length(d) * uAmount * 0.03;
      float r = texture2D(uTexture, uv + off).r;
      float g = texture2D(uTexture, uv).g;
      float b = texture2D(uTexture, uv - off).b;
      outColor = vec4(r, g, b, src.a);
    } else if (mode == 6) { // lens distortion
      vec2 d = uv - uCenter;
      float r2 = dot(d, d);
      vec2 duv = uv + d * r2 * (uAmount * 2.0 - 1.0) * 0.8;
      outColor = texture2D(uTexture, clamp(duv, 0.0, 1.0));
    } else if (mode == 7) { // halftone
      vec2 grid = floor(uv * uResolution / max(2.0, uAmount * 14.0));
      vec2 guv = (grid + 0.5) * max(2.0, uAmount * 14.0) / uResolution;
      vec4 c = texture2D(uTexture, guv);
      float ll = luma(c.rgb);
      vec2 local = fract(uv * uResolution / max(2.0, uAmount * 14.0)) - 0.5;
      float dotMask = step(length(local), ll * 0.55);
      outColor.rgb = mix(vec3(1.0 - dotMask), c.rgb, 0.25);
    } else if (mode == 8) { // toon
      float lv = floor(luma(src.rgb) * mix(3.0, 12.0, uAmount2)) / max(1.0, mix(3.0, 12.0, uAmount2));
      outColor.rgb = normalize(src.rgb + 0.0001) * lv;
    } else if (mode == 9) { // crt
      float scan = sin(uv.y * uResolution.y * 1.4) * 0.06 * uAmount;
      float mask = sin(uv.x * uResolution.x * 3.1415) * 0.04 * uAmount2;
      outColor.rgb = src.rgb * (1.0 - scan + mask);
      outColor.rgb *= 1.0 - smoothstep(0.2, 0.9, length(uv - 0.5) * mix(0.7, 1.3, uAmount3)) * 0.25;
    } else if (mode == 10) { // chroma key
      float d = distance(src.rgb, uColor);
      float a = smoothstep(uThreshold, uThreshold + max(0.001, uAmount), d);
      outColor = vec4(src.rgb, src.a * a);
    } else if (mode == 11) { // luma key
      float ll = luma(src.rgb);
      float a = smoothstep(uThreshold, uThreshold + max(0.001, uAmount), ll);
      outColor = vec4(src.rgb, src.a * a);
    } else if (mode == 12) { // displacement
      float n = sin((uv.y + uTime * 0.2) * 80.0) * cos((uv.x - uTime * 0.17) * 60.0);
      vec2 duv = uv + vec2(n, -n) * uAmount * 0.05;
      outColor = texture2D(uTexture, clamp(duv, 0.0, 1.0));
    } else if (mode == 13) { // twirl
      vec2 d = uv - uCenter;
      float r = length(d);
      float a = atan(d.y, d.x) + (1.0 - smoothstep(0.0, max(0.001, uAmount2), r)) * uAmount * 8.0;
      vec2 duv = uCenter + vec2(cos(a), sin(a)) * r;
      outColor = texture2D(uTexture, clamp(duv, 0.0, 1.0));
    } else if (mode == 14) { // pinch/bulge
      vec2 d = uv - uCenter;
      float r = length(d);
      float p = pow(r, mix(0.35, 2.2, uAmount));
      vec2 duv = uCenter + normalize(d + 1e-6) * p;
      outColor = texture2D(uTexture, clamp(duv, 0.0, 1.0));
    } else if (mode == 15) { // heat haze
      vec2 off = vec2(
        sin((uv.y + uTime * 0.9) * 70.0),
        cos((uv.x - uTime * 0.7) * 55.0)
      ) * uAmount * 0.01;
      outColor = texture2D(uTexture, clamp(uv + off, 0.0, 1.0));
    } else if (mode == 16) { // bloom
      float ll = luma(src.rgb);
      vec4 blur = sampleDir(uv, vec2(1.0, 0.0), max(px.x, px.y) * mix(8.0, 50.0, uAmount2))
        + sampleDir(uv, vec2(0.0, 1.0), max(px.x, px.y) * mix(8.0, 50.0, uAmount2));
      blur *= 0.5;
      float gate = smoothstep(uThreshold, uThreshold + 0.2, ll);
      outColor.rgb = src.rgb + blur.rgb * gate * uAmount;
    } else if (mode == 17) { // directional blur
      vec2 dir = vec2(cos(uAngle), sin(uAngle)) * px * 25.0;
      outColor = sampleDir(uv, dir, uAmount);
    } else if (mode == 18) { // zoom blur
      vec2 dir = (uCenter - uv) * 0.02;
      outColor = sampleDir(uv, dir, uAmount * 4.0);
    } else if (mode == 19) { // radial blur
      vec2 d = uv - uCenter;
      vec2 tang = vec2(-d.y, d.x) * 0.02;
      outColor = sampleDir(uv, tang, uAmount * 4.0);
    } else if (mode == 20) { // tilt shift
      float m = smoothstep(uAmount2 * 0.5, uAmount2, abs(uv.y - uCenter.y));
      vec4 blur = sampleDir(uv, vec2(px.x, 0.0), 18.0 * uAmount) + sampleDir(uv, vec2(0.0, px.y), 18.0 * uAmount);
      blur *= 0.5;
      outColor = mix(src, blur, m);
    } else if (mode == 21 || mode == 22) { // erode/dilate alpha by luma neighborhood
      float best = mode == 21 ? 1.0 : 0.0;
      for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
          float ll = luma(texture2D(uTexture, uv + vec2(float(x), float(y)) * px * (1.0 + uAmount * 6.0)).rgb);
          if (mode == 21) best = min(best, ll); else best = max(best, ll);
        }
      }
      outColor = vec4(src.rgb, src.a * best);
    } else if (mode == 23) { // compression artifacts
      vec2 block = floor(uv * uResolution / mix(4.0, 40.0, uAmount));
      vec2 buv = (block + 0.5) * mix(4.0, 40.0, uAmount) / uResolution;
      vec4 c = texture2D(uTexture, buv);
      outColor.rgb = floor(c.rgb * mix(8.0, 2.0, uAmount2)) / mix(8.0, 2.0, uAmount2);
    } else if (mode == 24) { // god rays
      vec2 ray = (uCenter - uv) * 0.02;
      vec4 acc = vec4(0.0);
      float w = 0.0;
      for (int i = 0; i < 16; i++) {
        float t = float(i) / 15.0;
        vec4 s = texture2D(uTexture, uv + ray * t * (2.0 + uAmount * 10.0));
        float m = smoothstep(uThreshold, uThreshold + 0.2, luma(s.rgb));
        acc += s * m;
        w += 1.0;
      }
      outColor.rgb = src.rgb + (acc.rgb / max(1.0, w)) * uAmount2;
    } else if (mode == 25) { // color balance
      outColor.rgb = src.rgb + (uColor - vec3(0.5)) * (uAmount * 0.8);
    } else if (mode == 26) { // curves-ish
      vec3 gamma = max(vec3(0.05), vec3(1.0) + (uColor - vec3(0.5)) * 2.0);
      outColor.rgb = pow(clamp(src.rgb, 0.0, 1.0), gamma);
    } else if (mode == 27) { // lift/gamma/gain
      outColor.rgb = pow(max(src.rgb + (uColor - vec3(0.5)) * 0.25, vec3(0.0)), vec3(max(0.05, 1.0 + (uAmount2 - 0.5))))
        * (0.8 + uAmount3 * 0.8);
    } else if (mode == 28) { // kuwahara-ish
      vec4 b = sampleDir(uv, vec2(px.x, px.y), 12.0 * max(0.05, uAmount));
      outColor = mix(src, b, 0.75);
    } else if (mode == 29) { // oil paint-ish
      vec4 b = sampleDir(uv, vec2(px.x, 0.0), 18.0 * max(0.05, uAmount));
      outColor.rgb = floor(b.rgb * mix(6.0, 20.0, uAmount2)) / mix(6.0, 20.0, uAmount2);
    } else if (mode == 30) { // watercolor-ish
      vec4 b = sampleDir(uv, vec2(px.x, px.y), 20.0 * max(0.05, uAmount));
      float e = abs(luma(texture2D(uTexture, uv + vec2(px.x, 0.0)).rgb) - luma(texture2D(uTexture, uv - vec2(px.x, 0.0)).rgb));
      outColor.rgb = mix(b.rgb, vec3(0.15), smoothstep(0.04, 0.18, e) * uAmount2);
    } else if (mode == 31) { // difference key approximation
      float d = distance(src.rgb, vec3(uThreshold));
      float a = smoothstep(uAmount, uAmount + max(0.001, uAmount2), d);
      outColor = vec4(src.rgb, src.a * a);
    }

    gl_FragColor = vec4(clamp(outColor.rgb, 0.0, 1.0), clamp(outColor.a, 0.0, 1.0));
  }
`;

// Mode mapping for proPackShader (existing 32 modes)
export const proEffectModes: Record<string, number> = {
  exposure: 0,
  gamma: 1,
  vibrance: 2,
  temperatureTint: 3,
  filmGrain: 4,
  chromaticAberration: 5,
  lensDistortion: 6,
  halftone: 7,
  toon: 8,
  crt: 9,
  chromaKey: 10,
  lumaKey: 11,
  displacement: 12,
  twirl: 13,
  pinchBulge: 14,
  heatHaze: 15,
  bloom: 16,
  directionalBlur: 17,
  zoomBlur: 18,
  radialBlur: 19,
  tiltShift: 20,
  erode: 21,
  dilate: 22,
  compressionArtifacts: 23,
  godRays: 24,
  colorBalance: 25,
  curves: 26,
  liftGammaGain: 27,
  kuwahara: 28,
  oilPaint: 29,
  watercolor: 30,
  differenceKey: 31,
};
