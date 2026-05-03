/*{
  "DESCRIPTION": "Complex evolving tree fractals with noise patterns and mind-warping waves",
  "CREDIT": "AI Generated",
  "CATEGORIES": ["generator", "fractal", "psychedelic"],
  "INPUTS": [
    { "NAME": "complexity", "TYPE": "float", "DEFAULT": 5.0, "MIN": 2.0, "MAX": 8.0, "LABEL": "Complexity" },
    { "NAME": "evolutionSpeed", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.1, "MAX": 2.0, "LABEL": "Evolution Speed" },
    { "NAME": "warpIntensity", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0, "LABEL": "Warp Intensity" },
    { "NAME": "colorShift", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0, "LABEL": "Color Shift" },
    { "NAME": "branchDensity", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0.2, "MAX": 1.0, "LABEL": "Branch Density" },
    { "NAME": "noiseScale", "TYPE": "float", "DEFAULT": 3.0, "MIN": 1.0, "MAX": 8.0, "LABEL": "Noise Scale" }
  ]
}*/

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p, float t) {
  float value = 0.0;
  float amplitude = 0.5;
  vec2 shift = vec2(100.0);
  mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
  
  for (int i = 0; i < 6; i++) {
    value += amplitude * noise(p + t * 0.1);
    p = rot * p * 2.0 + shift;
    amplitude *= 0.5;
  }
  return value;
}

float treeFractal(vec2 p, float t) {
  float result = 0.0;
  vec2 z = p;
  
  for (int i = 0; i < 12; i++) {
    float fi = float(i);
    z = abs(z) / dot(z, z) - branchDensity;
    z *= mat2(cos(t * 0.1 + fi * 0.2), sin(t * 0.1 + fi * 0.2), 
              -sin(t * 0.1 + fi * 0.2), cos(t * 0.1 + fi * 0.2));
    result += exp(-3.0 * abs(dot(z, vec2(0.5, 0.5))));
  }
  return result * 0.1;
}

vec2 warp(vec2 uv, float t) {
  float n1 = fbm(uv * noiseScale + t * 0.3, t);
  float n2 = fbm(uv * noiseScale * 1.5 - t * 0.2, t);
  
  float wave1 = sin(uv.x * 8.0 + t + n1 * 6.28) * 0.02;
  float wave2 = sin(uv.y * 6.0 - t * 0.7 + n2 * 6.28) * 0.02;
  float wave3 = sin(length(uv - 0.5) * 12.0 - t * 1.5) * 0.015;
  
  return uv + vec2(wave1 + wave3, wave2 + wave3) * warpIntensity;
}

vec3 palette(float t, float shift) {
  vec3 a = vec3(0.5, 0.5, 0.5);
  vec3 b = vec3(0.5, 0.5, 0.5);
  vec3 c = vec3(1.0, 1.0, 1.0);
  vec3 d = vec3(0.0 + shift, 0.33 + shift, 0.67 + shift);
  return a + b * cos(6.28318 * (c * t + d));
}

void main() {
  vec2 uv = isf_FragNormCoord;
  float t = TIME * evolutionSpeed;
  
  vec2 warpedUV = warp(uv, t);
  
  vec2 centeredUV = (warpedUV - 0.5) * complexity;
  
  float angle = atan(centeredUV.y, centeredUV.x);
  float radius = length(centeredUV);
  
  float spiral = angle + radius * 3.0 - t * 0.5;
  centeredUV += vec2(cos(spiral), sin(spiral)) * 0.1 * warpIntensity;
  
  float tree1 = treeFractal(centeredUV, t);
  float tree2 = treeFractal(centeredUV * 1.5 + vec2(1.0, 0.5), t * 0.7);
  float tree3 = treeFractal(centeredUV * 0.8 - vec2(0.5, 1.0), t * 1.3);
  
  float n = fbm(warpedUV * noiseScale * 2.0, t);
  float n2 = fbm(warpedUV * noiseScale * 4.0 + t, t * 0.5);
  
  float combined = tree1 + tree2 * 0.7 + tree3 * 0.5;
  combined = combined * (0.5 + n * 0.5);
  combined += n2 * 0.3;
  
  float pulse = sin(t * 2.0) * 0.5 + 0.5;
  combined *= 0.8 + pulse * 0.2;
  
  vec3 col1 = palette(combined * 0.5 + t * 0.1, colorShift);
  vec3 col2 = palette(combined * 0.3 - t * 0.05 + 0.5, colorShift + 0.33);
  vec3 col3 = palette(n + t * 0.15, colorShift + 0.67);
  
  vec3 finalColor = mix(col1, col2, tree1 / (tree1 + 0.5));
  finalColor = mix(finalColor, col3, n2 * 0.4);
  
  float glow = exp(-2.0 * abs(combined - 0.5));
  finalColor += glow * col1 * 0.3;
  
  float vignette = 1.0 - length(uv - 0.5) * 0.8;
  vignette = smoothstep(0.0, 1.0, vignette);
  finalColor *= vignette;
  
  finalColor = pow(finalColor, vec3(0.9));
  finalColor = clamp(finalColor, 0.0, 1.0);
  
  gl_FragColor = vec4(finalColor, 1.0);
}