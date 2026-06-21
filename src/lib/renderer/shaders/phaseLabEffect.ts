export const phaseLabShader = /* glsl */ `
  precision highp float;

  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uMode;
  uniform float uIntensity;
  uniform float uScale;
  uniform float uSpeed;
  uniform float uPhase;
  uniform float uMix;
  uniform float uColorGain;
  uniform float uSourceBleed;
  uniform float uEdgeBoost;
  uniform float uDistortion;
  uniform float uLineDensity;
  uniform float uPolarizerAngle;
  uniform float uSpectralShift;
  uniform float uFocus;
  uniform float uMirrorRadius;
  uniform float uConeLift;
  uniform float uAudioReactive;
  uniform float uAudioDrive;
  uniform float uAudio;
  uniform float uAudioBass;
  varying vec2 vUv;

  const float PI = 3.141592653589793;
  const float TAU = 6.283185307179586;

  float saturate(float v) { return clamp(v, 0.0, 1.0); }
  vec3 sat3(vec3 v) { return clamp(v, vec3(0.0), vec3(1.0)); }
  float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

  float hash21(vec2 p) {
    vec2 q = fract(p * vec2(123.34, 456.21));
    return fract((q.x + q.y) * (q.x + 34.345));
  }

  float hash31(vec3 p) {
    vec3 q = fract(p * vec3(443.897, 441.423, 437.195));
    return fract((q.x + q.y + q.z) * (q.x + 19.19));
  }

  float noise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 s = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, s.x), mix(c, d, s.x), s.y);
  }

  float fbm2(vec2 p) {
    float a = 0.5;
    float v = 0.0;
    for (int i = 0; i < 5; i++) {
      v += a * noise2(p);
      p = mat2(1.62, 1.18, -1.18, 1.62) * p + vec2(9.1, 2.7);
      a *= 0.5;
    }
    return v;
  }

  vec3 hsv2rgb(vec3 c) {
    vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
  }

  vec3 phasePalette(float x) {
    float h = fract(x);
    vec3 a = vec3(0.55, 0.48, 0.42);
    vec3 b = vec3(0.48, 0.54, 0.58);
    vec3 c = vec3(1.0);
    vec3 d = vec3(0.00, 0.22, 0.58);
    return sat3(a + b * cos(TAU * (c * h + d)));
  }

  vec4 sampleSrc(vec2 uv) {
    return texture2D(uTexture, clamp(uv, vec2(0.0), vec2(1.0)));
  }

  float sampleLum(vec2 uv) {
    return lum(sampleSrc(uv).rgb);
  }

  vec2 px() {
    return 1.0 / max(uResolution, vec2(2.0));
  }

  vec2 gradient(vec2 uv, float radius) {
    vec2 p = px() * max(1.0, radius);
    float l = sampleLum(uv - vec2(p.x, 0.0));
    float r = sampleLum(uv + vec2(p.x, 0.0));
    float d = sampleLum(uv - vec2(0.0, p.y));
    float up = sampleLum(uv + vec2(0.0, p.y));
    return vec2(r - l, up - d) * 0.5;
  }

  float laplace(vec2 uv, float radius) {
    vec2 p = px() * max(1.0, radius);
    float c = sampleLum(uv);
    float l = sampleLum(uv - vec2(p.x, 0.0));
    float r = sampleLum(uv + vec2(p.x, 0.0));
    float d = sampleLum(uv - vec2(0.0, p.y));
    float up = sampleLum(uv + vec2(0.0, p.y));
    return l + r + d + up - 4.0 * c;
  }

  vec3 bosMode(vec2 uv) {
    float t = uTime;
    float audioLift = uAudioReactive * uAudioDrive * max(uAudio, uAudioBass);
    float intensity = uIntensity * (1.0 + audioLift * 0.65);
    vec2 g = gradient(uv, 1.0 + uScale * 0.08) * uEdgeBoost * 4.0;
    vec2 curl = vec2(
      fbm2(uv * uScale + vec2(0.0, t * uSpeed)) - 0.5,
      fbm2(uv.yx * uScale + vec2(4.7, -t * uSpeed * 0.77)) - 0.5
    );
    vec2 flow = g + 0.18 * curl;
    vec3 refracted = sampleSrc(uv + flow * uDistortion * intensity).rgb;
    float edge = pow(saturate(length(g) * intensity * 5.0 + abs(laplace(uv, 1.0)) * 2.0), 0.55);
    float angle = atan(flow.y, flow.x) / TAU + 0.5;
    vec3 falseColor = phasePalette(angle + edge * 0.32 + uPhase + t * uSpeed * 0.05);
    vec3 ca = vec3(
      sampleSrc(uv + flow * uDistortion * 1.35).r,
      sampleSrc(uv + flow * uDistortion * 0.70).g,
      sampleSrc(uv - flow * uDistortion * 1.10).b
    );
    vec3 sci = falseColor * edge * uColorGain + ca * (0.25 + 0.55 * edge);
    return sat3(mix(refracted, sci, uMix));
  }

  vec3 photoelasticMode(vec2 uv) {
    float t = uTime;
    vec3 src = sampleSrc(uv).rgb;
    vec2 g = gradient(uv, 1.5) * uEdgeBoost;
    float angle = atan(g.y, g.x) + radians(uPolarizerAngle);
    float stress = length(g) * uIntensity * 14.0 + fbm2(uv * uScale + t * uSpeed * vec2(0.15, 0.0)) * 2.2;
    float phase = stress * uLineDensity + uPhase + 1.8 * sin(angle * 2.0 + t * uSpeed);
    vec3 iso = 0.5 + 0.5 * cos(vec3(0.0, 2.15, 4.32) + phase);
    float isoclinic = pow(abs(sin(2.0 * angle)), 0.55);
    vec3 fringe = sat3(iso * (0.25 + 0.85 * isoclinic));
    float dark = smoothstep(0.04, 0.42, abs(sin(phase * 0.5)));
    vec3 stressGlow = phasePalette(phase / TAU + uSpectralShift) * (0.25 + length(g) * 3.0);
    return sat3(mix(src, fringe * dark + stressGlow * 0.28, uMix) * uColorGain);
  }

  vec3 lippmannMode(vec2 uv) {
    float t = uTime;
    vec3 src = sampleSrc(uv).rgb;
    float l = lum(src);
    float view = (uv.x - 0.5) * 2.0 + sin(t * uSpeed) * 0.25 + uSpectralShift;
    float micro = fbm2(uv * uScale * 2.0 + vec2(t * uSpeed * 0.05, 0.0));
    vec3 standing = vec3(
      cos(l * 42.0 + view * 5.5 + micro * 6.0 + uPhase),
      cos(l * 55.0 + view * 7.0 + micro * 4.5 + uPhase + 1.8),
      cos(l * 69.0 + view * 8.5 + micro * 3.5 + uPhase + 3.4)
    ) * 0.5 + 0.5;
    vec3 spectral = phasePalette(l * 1.8 + view * 0.22 + micro * 0.35);
    vec3 irid = sat3(src * (0.35 + 0.9 * standing) + spectral * 0.45);
    float glint = pow(saturate(standing.r * standing.g * standing.b), 3.0);
    return sat3(mix(src, irid + glint * vec3(0.9, 0.95, 1.0), uMix) * uColorGain);
  }

  vec3 insarMode(vec2 uv) {
    float t = uTime;
    vec3 src = sampleSrc(uv).rgb;
    vec2 p = (uv - 0.5) * vec2(uResolution.x / max(1.0, uResolution.y), 1.0);
    float l = sampleLum(uv);
    float elev = l * uIntensity * 7.0
      + fbm2(uv * uScale + vec2(t * uSpeed * 0.08, 1.7)) * 2.0
      + length(p) * 5.0;
    float phase = elev * uLineDensity + uPhase + t * uSpeed;
    float wrapped = fract(phase / TAU);
    vec3 fringe = hsv2rgb(vec3(wrapped, 0.86, 1.0));
    float contour = 1.0 - smoothstep(0.0, 0.055, abs(fract(phase / TAU) - 0.5));
    float speckle = pow(hash31(vec3(floor(uv * uResolution / max(1.0, uScale * 0.25)), floor(t * 12.0))), 1.8);
    vec3 radar = fringe * (0.62 + speckle * 0.55) + contour * vec3(0.9, 1.0, 1.0) * 0.35;
    return sat3(mix(src, radar, uMix) * uColorGain);
  }

  vec3 catoptricMode(vec2 uv, bool cone) {
    float t = uTime;
    vec3 src = sampleSrc(uv).rgb;
    vec2 p = uv - 0.5;
    float r = length(p);
    float a = atan(p.y, p.x);
    float radius = clamp(uMirrorRadius, 0.03, 0.46);
    float ringStart = radius * 1.05;
    float ringEnd = 0.72;
    float ringT = saturate((r - ringStart) / max(0.001, ringEnd - ringStart));
    float y = cone ? pow(ringT, max(0.08, uConeLift)) : pow(ringT, max(0.08, uFocus));
    float x = fract(a / TAU + 0.5 + 0.03 * sin(t * uSpeed + y * TAU));
    vec2 prewarpUV = vec2(x, 1.0 - y);
    float annulus = smoothstep(ringStart, ringStart + 0.02, r) * (1.0 - smoothstep(ringEnd - 0.02, ringEnd, r));
    float mirrorBody = 1.0 - smoothstep(radius * 0.85, radius, r);
    vec3 warped = sampleSrc(prewarpUV).rgb;
    vec3 metal = vec3(0.78, 0.82, 0.86) * (0.35 + 0.65 * pow(1.0 - saturate(r / radius), 1.8));
    vec3 reflected = sampleSrc(vec2(fract(a / TAU + 0.5), saturate(r / radius))).rgb;
    float grid = 0.18 * (1.0 - smoothstep(0.01, 0.035, abs(fract(x * 24.0) - 0.5)));
    vec3 field = warped * annulus + (mix(metal, reflected, 0.35) + phasePalette(a / TAU + t * 0.02) * 0.18) * mirrorBody;
    vec3 glow = phasePalette(x + y + uPhase) * grid * annulus;
    return sat3(mix(src, field + glow, uMix) * uColorGain);
  }

  vec3 dtiMode(vec2 uv) {
    float t = uTime;
    vec3 src = sampleSrc(uv).rgb;
    vec2 g = gradient(uv, 1.2) * uEdgeBoost;
    float n = fbm2(uv * uScale + vec2(t * uSpeed * 0.08, 0.0));
    float angle = atan(g.y, g.x) + (n - 0.5) * PI * 1.2 + uPhase;
    vec2 dir = vec2(cos(angle), sin(angle));
    vec2 normal = vec2(-dir.y, dir.x);
    float along = dot(uv - 0.5, dir);
    float across = dot(uv - 0.5, normal);
    float ribbonPhase = across * uLineDensity + sin(along * uScale * 8.0 + t * uSpeed) * 0.9;
    float stripe = pow(1.0 - smoothstep(0.0, 0.42, abs(fract(ribbonPhase) - 0.5)), 1.7);
    float anisotropy = saturate(length(g) * uIntensity * 7.0 + n * 0.4);
    float twist = 0.5 + 0.5 * sin(along * uLineDensity * 0.7 + t * uSpeed + angle * 2.0);
    vec3 fiber = phasePalette(angle / TAU + twist * 0.18 + uSpectralShift) * stripe * (0.25 + anisotropy);
    vec3 body = src * (0.18 + uSourceBleed) + fiber * (1.0 + anisotropy);
    return sat3(mix(src, body, uMix) * uColorGain);
  }

  vec3 compositeMode(vec2 uv) {
    vec3 a = bosMode(uv);
    vec3 b = photoelasticMode(uv);
    vec3 c = insarMode(uv);
    vec3 d = lippmannMode(uv);
    float w = 0.5 + 0.5 * sin(uTime * uSpeed + uPhase);
    return sat3(mix(mix(a, b, 0.5), mix(c, d, 0.5), w));
  }

  void main() {
    vec4 src = sampleSrc(vUv);
    int mode = int(floor(uMode + 0.5));
    vec3 col;
    if (mode == 0) {
      col = bosMode(vUv);
    } else if (mode == 1) {
      col = photoelasticMode(vUv);
    } else if (mode == 2) {
      col = lippmannMode(vUv);
    } else if (mode == 3) {
      col = insarMode(vUv);
    } else if (mode == 4) {
      col = catoptricMode(vUv, false);
    } else if (mode == 5) {
      col = catoptricMode(vUv, true);
    } else if (mode == 6) {
      col = dtiMode(vUv);
    } else {
      col = compositeMode(vUv);
    }

    col = mix(col, src.rgb, clamp(uSourceBleed, 0.0, 1.0));
    gl_FragColor = vec4(sat3(col), src.a);
  }
`;
