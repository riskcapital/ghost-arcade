/**
 * Time-based effects: Time Smear & Chronophotography
 * Single-frame post-processing effects that create temporal/motion illusions.
 */

// ─── Time Smear / Motion Smear ──────────────────────────────────────────────
export const timeSmearShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uMode;
  uniform float uAmount;
  uniform float uAmount2;
  uniform float uSpeed;
  varying vec2 vUv;

  void main() {
    int mode = int(uMode + 0.5);
    vec2 uv = vUv;
    float intensity = uAmount2;
    float t = uTime * uSpeed;

    vec4 color = vec4(0.0);

    if (mode == 0) {
      float linePos = uAmount;
      float dist = uv.x - linePos;
      float strength = dist * intensity;
      for (int i = 0; i < 16; i++) {
        float fi = float(i) / 15.0;
        vec2 offset = vec2(strength * fi * sin(t * 0.3 + fi), 0.0);
        color += texture2D(uTexture, clamp(uv - offset, 0.0, 1.0));
      }
      color /= 16.0;
    }
    else if (mode == 1) {
      float linePos = uAmount;
      float dist = uv.y - linePos;
      float strength = dist * intensity;
      for (int i = 0; i < 16; i++) {
        float fi = float(i) / 15.0;
        vec2 offset = vec2(0.0, strength * fi * sin(t * 0.3 + fi));
        color += texture2D(uTexture, clamp(uv - offset, 0.0, 1.0));
      }
      color /= 16.0;
    }
    else if (mode == 2) {
      vec2 center = vec2(uAmount, 0.5);
      vec2 dir = uv - center;
      float dist = length(dir);
      float strength = dist * intensity;
      for (int i = 0; i < 16; i++) {
        float fi = float(i) / 15.0;
        vec2 offset = normalize(dir + vec2(0.001)) * strength * fi;
        color += texture2D(uTexture, clamp(uv - offset, 0.0, 1.0));
      }
      color /= 16.0;
    }
    else {
      vec2 center = vec2(0.5);
      vec2 d = uv - center;
      float angle = atan(d.y, d.x);
      float dist = length(d);
      float strength = intensity * 0.3;
      for (int i = 0; i < 16; i++) {
        float fi = float(i) / 15.0 - 0.5;
        float a = angle + fi * strength;
        vec2 p = center + vec2(cos(a), sin(a)) * dist;
        color += texture2D(uTexture, clamp(p, 0.0, 1.0));
      }
      color /= 16.0;
    }

    gl_FragColor = color;
  }
`;

// ─── Chronophotography ──────────────────────────────────────────────────────
export const chronoShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uMode;
  uniform float uAmount;
  uniform float uAmount2;
  uniform float uSpeed;
  varying vec2 vUv;

  void main() {
    int mode = int(uMode + 0.5);
    float t = uTime * uSpeed;
    float spread = uAmount2;
    int echoes = int(uAmount * 8.0 + 2.0);
    if (echoes > 10) echoes = 10;

    vec4 color = vec4(0.0);
    float totalWeight = 0.0;

    for (int i = 0; i < 10; i++) {
      if (i >= echoes) break;
      float fi = float(i) / float(echoes - 1);
      float weight = 1.0 - fi * 0.7;
      vec2 offset = vec2(0.0);

      if (mode == 0) {
        offset = vec2(spread * (fi - 0.5) * sin(t * 0.5), spread * 0.1 * sin(t + fi * 3.0));
      } else if (mode == 1) {
        float angle = fi * 6.28 * 0.5 + t * 0.3;
        offset = vec2(cos(angle), sin(angle)) * spread * fi * 0.3;
      } else if (mode == 2) {
        vec2 centered = vUv - 0.5;
        offset = centered * fi * spread * 0.5;
      } else {
        float angle = fi * 6.28 + t * 0.5;
        float radius = fi * spread * 0.2;
        offset = vec2(cos(angle) * radius, sin(angle) * radius);
      }

      color += texture2D(uTexture, clamp(vUv + offset, 0.0, 1.0)) * weight;
      totalWeight += weight;
    }

    gl_FragColor = color / totalWeight;
  }
`;
