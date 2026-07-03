// Splat Renderer - Three.js based point cloud and gaussian splat renderer
// Implements all animations, effects, and interactions for splat layers

import * as THREE from 'three';
import type { PLYData, PLYVertex } from './plyLoader';
import type { SplatContent, SplatAnimationType, SplatDisplacementType, SplatColorEffectType, SplatOpacityEffectType, SplatCreativeEffectType } from '../types';

const SPLAT_AUTO_FIT_SIZE = 20;
const MIN_AUTO_FIT_SCALE = 0.00001;
const MAX_AUTO_FIT_SCALE = 10000;
const MIN_GAUSSIAN_POINT_SCALE = 0.45;
const MAX_GAUSSIAN_POINT_SCALE = 10;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getBoundsSize(data: PLYData): number {
  const bb = data.boundingBox;
  return Math.max(
    bb.max.x - bb.min.x,
    bb.max.y - bb.min.y,
    bb.max.z - bb.min.z
  );
}

function getGaussianPointScale(vertex: PLYVertex, fitScale: number): number {
  if (vertex.scale_0 === undefined || vertex.scale_1 === undefined || vertex.scale_2 === undefined) {
    return 1;
  }

  const averageLogScale = (vertex.scale_0 + vertex.scale_1 + vertex.scale_2) / 3;
  const rawRadius = Math.exp(clamp(averageLogScale, -12, 8));
  const normalizedRadius = rawRadius * fitScale;
  return clamp(0.65 + normalizedRadius * 160, MIN_GAUSSIAN_POINT_SCALE, MAX_GAUSSIAN_POINT_SCALE);
}

// Vertex shader for point cloud rendering with all effects
const vertexShader = `
  uniform float time;
  uniform float pointSize;
  uniform bool sizeAttenuation;

  // Animation uniforms
  uniform float animationProgress;
  uniform float animationIntensity;
  uniform int animationType;
  uniform float explodeForce;
  uniform float voxelGridSize;
  uniform vec3 peelAxis;
  uniform float gravity;
  uniform float turbulence;

  // Displacement uniforms
  uniform int displacementType;
  uniform float displacementAmount;
  uniform float noiseScale;
  uniform float noiseSpeed;
  uniform float waveFrequency;
  uniform float waveAmplitude;
  uniform float glitchIntensity;
  uniform vec3 windDirection;
  uniform float windStrength;

  // Audio uniforms
  uniform bool audioEnabled;
  uniform float audioLevel;
  uniform float audioDisplacement;
  uniform float audioScale;
  uniform float beatIntensity;
  uniform float beatPhase;

  // Transform uniforms
  uniform float scaleUniform;
  uniform vec3 rotation3D;
  uniform vec3 position3D;

  // Slice plane
  uniform bool sliceEnabled;
  uniform vec3 sliceAxis;
  uniform float slicePosition;
  uniform float sliceThickness;

  // Mouse interaction
  uniform vec3 mousePosition;
  uniform float mouseInfluence;
  uniform float mouseRadius;
  uniform int mouseMode;

  attribute vec3 originalPosition;
  attribute vec3 color;
  attribute float alpha;
  attribute float pointScale;
  attribute float vertexIndex;
  attribute vec3 velocity;
  attribute vec2 texUV;

  varying vec3 vColor;
  varying float vAlpha;
  varying float vDiscard;
  varying vec3 vPosition;
  varying float vVertexIndex;
  varying float vMouseDistance; // For reveal effect in fragment shader
  varying vec2 vTexUV;

  // Simplex noise functions
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

  float snoise(vec3 v) {
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
      + i.y + vec4(0.0, i1.y, i2.y, 1.0))
      + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ *ns.x + ns.yyyy;
    vec4 y = y_ *ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0)*2.0 + 1.0;
    vec4 s1 = floor(b1)*2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
  }

  // Apply animation to position
  vec3 applyAnimation(vec3 pos, vec3 origPos) {
    float t = animationProgress * animationIntensity;

    // Explode - points move outward from center
    if (animationType == 1) {
      vec3 dir = normalize(origPos);
      return pos + dir * t * explodeForce;
    }

    // Implode - points move toward center
    if (animationType == 2) {
      vec3 dir = normalize(origPos);
      return pos - dir * t * explodeForce;
    }

    // Slice - plane reveals/hides
    if (animationType == 3) {
      float planePos = (t * 2.0 - 1.0) * 2.0;
      float dist = dot(pos, normalize(peelAxis));
      if (dist > planePos) {
        vDiscard = 1.0;
      }
      return pos;
    }

    // Voxel snap - points snap to grid
    if (animationType == 4) {
      vec3 gridPos = floor(origPos * voxelGridSize + 0.5) / voxelGridSize;
      return mix(origPos, gridPos, t);
    }

    // Peel - layer by layer reveal
    if (animationType == 5) {
      float layerPos = dot(origPos, normalize(peelAxis));
      float revealThreshold = mix(-2.0, 2.0, t);
      if (layerPos > revealThreshold) {
        vDiscard = 1.0;
      }
      return pos;
    }

    // Gravity - points fall
    if (animationType == 6) {
      float fallTime = max(0.0, t - vertexIndex * 0.0001);
      return pos + vec3(0.0, -gravity * fallTime * fallTime, 0.0);
    }

    // Swarm - flocking behavior with noise-driven velocity fields
    if (animationType == 7) {
      float id = vertexIndex * 0.00137;
      // Cohesion: drift toward local center with noise-based group assignment
      float groupPhase = floor(snoise(origPos * 0.5) * 4.0) * 1.57;
      vec3 groupCenter = vec3(
        sin(time * 0.7 + groupPhase) * 0.8,
        cos(time * 0.5 + groupPhase * 0.7) * 0.5,
        sin(time * 0.6 + groupPhase * 1.3) * 0.8
      );
      vec3 toCenter = groupCenter - origPos;
      // Separation: push away from neighbors using noise
      vec3 separation = vec3(
        snoise(origPos * 3.0 + time * 1.5),
        snoise(origPos * 3.0 + time * 1.5 + 50.0),
        snoise(origPos * 3.0 + time * 1.5 + 100.0)
      ) * 0.4;
      // Alignment: smooth directional flow
      vec3 flow = vec3(
        snoise(origPos * 0.8 + time * 0.8 + 200.0),
        snoise(origPos * 0.8 + time * 0.6 + 300.0) * 0.5,
        snoise(origPos * 0.8 + time * 0.8 + 400.0)
      ) * 0.6;
      vec3 swarmOffset = (toCenter * 0.3 + separation + flow) * t * turbulence;
      return pos + swarmOffset;
    }

    // Morph - points transition toward a sphere surface
    if (animationType == 8) {
      // Calculate target position on a sphere
      float r = length(origPos);
      float avgR = max(r, 0.001);
      vec3 spherePos = normalize(origPos) * avgR;
      // Add some rotation on the sphere for visual interest
      float angle = t * 1.5 + vertexIndex * 0.0001;
      float cosA = cos(angle * 0.3);
      float sinA = sin(angle * 0.3);
      vec3 rotatedSphere = vec3(
        spherePos.x * cosA - spherePos.z * sinA,
        spherePos.y + sin(time * 0.5 + length(origPos.xz) * 3.0) * 0.1 * t,
        spherePos.x * sinA + spherePos.z * cosA
      );
      return mix(pos, rotatedSphere, t);
    }

    // Orbit - points rotate around center
    if (animationType == 9) {
      float angle = t * 6.28318 + vertexIndex * 0.01;
      float r = length(pos.xz);
      return vec3(cos(angle) * r, pos.y, sin(angle) * r);
    }

    // Wave 3D - wave propagation
    if (animationType == 10) {
      float wave = sin(length(origPos.xz) * 5.0 - time * 3.0) * 0.3 * t;
      return pos + vec3(0.0, wave, 0.0);
    }

    // Scatter - random dispersion
    if (animationType == 11) {
      vec3 scatter = vec3(
        snoise(origPos * 10.0 + time),
        snoise(origPos * 10.0 + time + 100.0),
        snoise(origPos * 10.0 + time + 200.0)
      );
      return pos + scatter * t * 2.0;
    }

    // Spiral - spiral motion
    if (animationType == 12) {
      float angle = t * 6.28318 * 2.0 + vertexIndex * 0.001;
      float spiral = t * 2.0;
      vec3 spiralOffset = vec3(cos(angle) * spiral, t * 2.0, sin(angle) * spiral);
      return pos + spiralOffset * 0.5;
    }

    return pos;
  }

  // Apply displacement effect
  vec3 applyDisplacement(vec3 pos) {
    if (displacementType == 0) return pos;

    // Noise displacement
    if (displacementType == 1) {
      float noise = snoise(pos * noiseScale + time * noiseSpeed);
      vec3 noiseDir = vec3(
        snoise(pos * noiseScale + vec3(100.0, 0.0, 0.0) + time * noiseSpeed),
        snoise(pos * noiseScale + vec3(0.0, 100.0, 0.0) + time * noiseSpeed),
        snoise(pos * noiseScale + vec3(0.0, 0.0, 100.0) + time * noiseSpeed)
      );
      return pos + noiseDir * displacementAmount;
    }

    // Audio reactive displacement (enhanced with beat pulse)
    if (displacementType == 2 && audioEnabled) {
      vec3 dir = normalize(pos);
      float audioDisp = audioLevel * audioDisplacement;
      // Beat pulse adds extra displacement burst
      audioDisp += beatIntensity * audioDisplacement * 0.5;
      return pos + dir * audioDisp;
    }

    // Wave displacement
    if (displacementType == 3) {
      float wave = sin(pos.x * waveFrequency + time * 2.0) * waveAmplitude;
      wave += sin(pos.z * waveFrequency + time * 1.5) * waveAmplitude;
      return pos + vec3(0.0, wave * displacementAmount, 0.0);
    }

    // Glitch displacement
    if (displacementType == 4) {
      float glitch = step(0.99 - glitchIntensity * 0.1, fract(sin(time * 100.0 + vertexIndex) * 43758.5453));
      vec3 offset = vec3(
        fract(sin(vertexIndex * 12.9898 + time) * 43758.5453) - 0.5,
        fract(sin(vertexIndex * 78.233 + time) * 43758.5453) - 0.5,
        fract(sin(vertexIndex * 45.164 + time) * 43758.5453) - 0.5
      );
      return pos + offset * glitch * displacementAmount;
    }

    // Wind displacement
    if (displacementType == 5) {
      float wind = snoise(pos * 2.0 + windDirection * time * windStrength);
      return pos + windDirection * wind * displacementAmount;
    }

    // Ripple displacement
    if (displacementType == 7) {
      float dist = length(pos - mousePosition);
      float ripple = sin(dist * 10.0 - time * 5.0) * exp(-dist * 2.0);
      return pos + normalize(pos - mousePosition) * ripple * displacementAmount;
    }

    return pos;
  }

  // Apply mouse interaction
  vec3 applyMouseInteraction(vec3 pos) {
    if (mouseInfluence <= 0.0) return pos;

    // Calculate distance - use a scaled influence for better feel
    float dist = length(pos - mousePosition);

    // Smooth falloff from center to edge of radius
    float influence = smoothstep(mouseRadius, 0.0, dist) * mouseInfluence;

    // Avoid NaN when point is exactly at mouse position
    vec3 dir = dist > 0.001 ? normalize(pos - mousePosition) : vec3(0.0, 1.0, 0.0);

    // Scale effect strength based on distance for more natural feel
    float effectStrength = mouseRadius * 0.5;

    // Attract - points move toward mouse
    if (mouseMode == 0) {
      return pos - dir * influence * effectStrength;
    }

    // Repel - points move away from mouse
    if (mouseMode == 1) {
      return pos + dir * influence * effectStrength;
    }

    // Swirl - points orbit around mouse
    if (mouseMode == 2) {
      float angle = influence * 3.14159 * 2.0;
      vec3 offset = pos - mousePosition;
      vec3 swirl = vec3(
        offset.x * cos(angle) - offset.z * sin(angle),
        offset.y,
        offset.x * sin(angle) + offset.z * cos(angle)
      );
      return mousePosition + mix(offset, swirl, influence);
    }

    // Reveal - fade in points near mouse (handled in fragment shader via varying)
    // Just return position unchanged for reveal mode
    return pos;
  }

  void main() {
    vColor = color;
    vAlpha = alpha;
    vDiscard = 0.0;
    vMouseDistance = 1000.0; // Default to far away

    vec3 pos = originalPosition;

    // Apply transforms
    pos *= scaleUniform;

    // Apply rotation (simplified euler rotation)
    float cx = cos(rotation3D.x);
    float sx = sin(rotation3D.x);
    float cy = cos(rotation3D.y);
    float sy = sin(rotation3D.y);
    float cz = cos(rotation3D.z);
    float sz = sin(rotation3D.z);

    mat3 rotX = mat3(1, 0, 0, 0, cx, -sx, 0, sx, cx);
    mat3 rotY = mat3(cy, 0, sy, 0, 1, 0, -sy, 0, cy);
    mat3 rotZ = mat3(cz, -sz, 0, sz, cz, 0, 0, 0, 1);

    pos = rotZ * rotY * rotX * pos;
    pos += position3D;

    // Apply animation
    pos = applyAnimation(pos, originalPosition);

    // Apply displacement
    pos = applyDisplacement(pos);

    // Calculate mouse distance for reveal effect (before moving points)
    vMouseDistance = length(pos - mousePosition) / max(mouseRadius, 0.001);

    // Apply mouse interaction
    pos = applyMouseInteraction(pos);

    // Apply audio scale
    if (audioEnabled) {
      pos *= 1.0 + audioLevel * audioScale;
    }

    // Check slice plane
    if (sliceEnabled) {
      float dist = dot(pos, sliceAxis);
      float halfThickness = sliceThickness * 0.5;
      if (abs(dist - slicePosition) > halfThickness) {
        vDiscard = 1.0;
      }
    }

    vPosition = pos;
    vVertexIndex = vertexIndex;
    vTexUV = texUV;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    // Point size with optional attenuation + beat pulse
    float size = pointSize * pointScale;
    if (audioEnabled) {
      size *= 1.0 + audioLevel * audioScale * 0.5;
      // Beat pulse on point size
      size *= 1.0 + beatIntensity * audioScale * 0.3;
    }
    if (sizeAttenuation) {
      size *= (300.0 / -mvPosition.z);
    }
    gl_PointSize = size;
  }
`;

// Fragment shader with color, opacity, render mode, and creative effects
const fragmentShader = `
  uniform float time;
  uniform float opacity;
  uniform int renderMode;

  // Color effect uniforms
  uniform int colorEffectType;
  uniform float colorEffectIntensity;
  uniform float hueShift;
  uniform bool useOriginalColors;
  uniform vec3 colorA;
  uniform vec3 colorB;
  uniform float colorMix;
  uniform float hologramSpeed;
  uniform float hologramDensity;

  // Opacity effect uniforms
  uniform int opacityEffectType;
  uniform float opacityEffectIntensity;
  uniform float dofFocalDistance;
  uniform float dofBlurAmount;
  uniform float fogDensity;
  uniform vec3 fogColor;
  uniform float pulseSpeed;
  uniform float dissolveProgress;

  // Creative effect uniforms
  uniform int creativeEffectType;
  uniform float creativeEffectIntensity;
  uniform float trailLength;

  // Audio uniforms
  uniform bool audioEnabled;
  uniform float audioLevel;
  uniform float audioColor;
  uniform float beatIntensity;
  uniform float beatPhase;

  // Texture mapping uniforms
  uniform bool textureEnabled;
  uniform sampler2D textureMap;
  uniform float textureBlend;
  uniform int textureProjection; // 0=spherical, 1=cylindrical, 2=planarXY, 3=planarXZ, 4=planarYZ, 5=box, 6=native
  uniform float textureScale;
  uniform vec2 textureOffset;
  uniform vec3 pointCloudMin;  // Bounding box min for UV calculation
  uniform vec3 pointCloudMax;  // Bounding box max for UV calculation

  varying vec3 vColor;
  varying float vAlpha;
  varying float vDiscard;
  varying vec3 vPosition;
  varying float vVertexIndex;
  varying float vMouseDistance;
  varying vec2 vTexUV;

  // Mouse uniforms for reveal mode
  uniform int mouseMode;
  uniform float mouseInfluence;

  // Calculate UV coordinates based on projection mode
  vec2 calculateUV(vec3 pos) {
    // Normalize position to 0-1 range based on bounding box
    vec3 normalizedPos = (pos - pointCloudMin) / (pointCloudMax - pointCloudMin);

    vec2 uv;

    if (textureProjection == 0) {
      // Spherical projection
      vec3 dir = normalize(pos);
      uv.x = 0.5 + atan(dir.z, dir.x) / (2.0 * 3.14159265);
      uv.y = 0.5 - asin(clamp(dir.y, -1.0, 1.0)) / 3.14159265;
    }
    else if (textureProjection == 1) {
      // Cylindrical projection
      vec3 dir = normalize(vec3(pos.x, 0.0, pos.z));
      uv.x = 0.5 + atan(dir.z, dir.x) / (2.0 * 3.14159265);
      uv.y = normalizedPos.y;
    }
    else if (textureProjection == 2) {
      // Planar XY (front view)
      uv = normalizedPos.xy;
    }
    else if (textureProjection == 3) {
      // Planar XZ (top view)
      uv = normalizedPos.xz;
    }
    else if (textureProjection == 4) {
      // Planar YZ (side view)
      uv = normalizedPos.yz;
    }
    else if (textureProjection == 6) {
      // Native UVs from file — bypass procedural calculation
      uv = vTexUV;
      // Apply scale and offset, then return directly
      uv = (uv - 0.5) * textureScale + 0.5 + textureOffset;
      return uv;
    }
    else {
      // Box projection - use the dominant axis
      vec3 absPos = abs(normalize(pos));
      if (absPos.x >= absPos.y && absPos.x >= absPos.z) {
        uv = normalizedPos.zy;
      } else if (absPos.y >= absPos.x && absPos.y >= absPos.z) {
        uv = normalizedPos.xz;
      } else {
        uv = normalizedPos.xy;
      }
    }

    // Apply scale and offset
    uv = (uv - 0.5) * textureScale + 0.5 + textureOffset;

    return uv;
  }

  // Noise function for effects
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float noise2D(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  // HSV to RGB conversion
  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  // RGB to HSV conversion
  vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
  }

  // Apply color effect
  vec3 applyColorEffect(vec3 color) {
    float intensity = colorEffectIntensity;

    // Apply hue shift first
    if (hueShift != 0.0) {
      vec3 hsv = rgb2hsv(color);
      hsv.x = fract(hsv.x + hueShift / 360.0);
      color = hsv2rgb(hsv);
    }

    if (colorEffectType == 0) return color;

    // 1: Chromatic shift - rainbow based on 3D position
    if (colorEffectType == 1) {
      vec3 hsv = rgb2hsv(color);
      float posHash = (vPosition.x + vPosition.y + vPosition.z) * 0.05;
      hsv.x = fract(hsv.x + posHash * intensity + time * 0.05);
      hsv.y = min(1.0, hsv.y + 0.3 * intensity);
      return mix(color, hsv2rgb(hsv), intensity);
    }

    // 2: Heatmap - proper thermal gradient
    if (colorEffectType == 2) {
      float heat = clamp((vPosition.y + 5.0) / 10.0, 0.0, 1.0);
      vec3 cold = vec3(0.0, 0.0, 0.5);
      vec3 cool = vec3(0.0, 0.5, 1.0);
      vec3 warm = vec3(1.0, 1.0, 0.0);
      vec3 hot = vec3(1.0, 0.0, 0.0);
      vec3 heatColor;
      if (heat < 0.33) {
        heatColor = mix(cold, cool, heat * 3.0);
      } else if (heat < 0.66) {
        heatColor = mix(cool, warm, (heat - 0.33) * 3.0);
      } else {
        heatColor = mix(warm, hot, (heat - 0.66) * 3.0);
      }
      return mix(color, heatColor, intensity);
    }

    // 3: Pointillist - per-point color cycling with offset
    if (colorEffectType == 3) {
      vec3 hsv = rgb2hsv(color);
      float pointOffset = hash(vPosition.xy) * 6.28;
      hsv.x = fract(hsv.x + sin(time * 2.0 + pointOffset) * 0.5 * intensity);
      hsv.y = min(1.0, hsv.y + 0.2 * intensity);
      hsv.z = min(1.0, hsv.z + 0.1 * intensity);
      return hsv2rgb(hsv);
    }

    // 4: Hologram
    if (colorEffectType == 4) {
      float scan = fract(vPosition.y * hologramDensity * 0.1 + time * hologramSpeed);
      vec3 holo = vec3(0.2, 0.8, 1.0);
      float flicker = 0.9 + 0.1 * sin(time * 30.0 + vPosition.x * 10.0);
      return mix(color, holo * flicker, scan * intensity);
    }

    // 5: Rainbow - smooth rainbow based on position
    if (colorEffectType == 5) {
      float hue = fract((vPosition.y + vPosition.x * 0.3) * 0.1 + time * 0.1);
      vec3 rainbow = hsv2rgb(vec3(hue, 1.0, 1.0));
      return mix(color, rainbow, intensity);
    }

    // 6: Audio color (with beat flash)
    if (colorEffectType == 6 && audioEnabled) {
      vec3 hsv = rgb2hsv(color);
      hsv.x = fract(hsv.x + audioLevel * audioColor);
      hsv.y = min(1.0, hsv.y + audioLevel * 0.5);
      hsv.z = min(1.0, hsv.z + audioLevel * 0.3);
      // Beat flash: bright pulse on beats
      hsv.z = min(1.0, hsv.z + beatIntensity * 0.4);
      hsv.y = max(0.0, hsv.y - beatIntensity * 0.3);
      return hsv2rgb(hsv);
    }

    // 7: Depth gradient
    if (colorEffectType == 7) {
      float depth = clamp((vPosition.z + 10.0) / 20.0, 0.0, 1.0);
      vec3 near = vec3(1.0, 0.3, 0.1);
      vec3 far = vec3(0.1, 0.3, 1.0);
      return mix(color, mix(near, far, depth), intensity);
    }

    // 8: Neon glow
    if (colorEffectType == 8) {
      vec3 hsv = rgb2hsv(color);
      hsv.y = 1.0;
      hsv.z = 1.0;
      vec3 neon = hsv2rgb(hsv);
      float glow = 1.0 + 0.5 * sin(time * 3.0 + vPosition.x * 5.0);
      return mix(color, neon * glow, intensity);
    }

    // 9: Pastel
    if (colorEffectType == 9) {
      vec3 hsv = rgb2hsv(color);
      hsv.s *= 0.4;
      hsv.z = 0.9 + 0.1 * hsv.z;
      return mix(color, hsv2rgb(hsv), intensity);
    }

    // 10: Cyberpunk (magenta/cyan)
    if (colorEffectType == 10) {
      float t = sin(vPosition.x * 2.0 + time) * 0.5 + 0.5;
      vec3 magenta = vec3(1.0, 0.0, 0.8);
      vec3 cyan = vec3(0.0, 1.0, 1.0);
      vec3 cyber = mix(magenta, cyan, t);
      return mix(color, cyber, intensity);
    }

    // 11: Fire
    if (colorEffectType == 11) {
      float fire = noise2D(vPosition.xy * 3.0 + vec2(0.0, -time * 2.0));
      vec3 fireColor = mix(vec3(1.0, 0.0, 0.0), vec3(1.0, 1.0, 0.0), fire);
      fireColor = mix(fireColor, vec3(1.0, 0.5, 0.0), sin(fire * 3.14));
      return mix(color, fireColor, intensity);
    }

    // 12: Ice
    if (colorEffectType == 12) {
      float ice = noise2D(vPosition.xy * 2.0 + time * 0.2);
      vec3 iceColor = mix(vec3(0.7, 0.9, 1.0), vec3(0.3, 0.6, 0.9), ice);
      return mix(color, iceColor, intensity);
    }

    return color;
  }

  // Apply opacity effect
  float applyOpacityEffect(float alpha) {
    if (opacityEffectType == 0) return alpha;

    // DOF fade
    if (opacityEffectType == 1) {
      float dist = abs(vPosition.z - dofFocalDistance * 4.0 - 2.0);
      float blur = smoothstep(0.0, dofBlurAmount * 3.0, dist);
      return alpha * (1.0 - blur * opacityEffectIntensity);
    }

    // Fog
    if (opacityEffectType == 2) {
      float dist = length(vPosition);
      float fog = 1.0 - exp(-dist * fogDensity * 0.1);
      return alpha * (1.0 - fog * opacityEffectIntensity);
    }

    // Pulse
    if (opacityEffectType == 3) {
      float pulse = (sin(time * pulseSpeed * 3.14159) + 1.0) * 0.5;
      return alpha * (1.0 - (1.0 - pulse) * opacityEffectIntensity);
    }

    // Proximity (type 4)
    if (opacityEffectType == 4) {
      float dist = length(vPosition);
      float prox = 1.0 - smoothstep(0.0, 5.0, dist);
      return alpha * mix(1.0, prox, opacityEffectIntensity);
    }

    // Dissolve
    if (opacityEffectType == 5) {
      float noise = hash(vPosition.xy + vPosition.z);
      if (noise < dissolveProgress * opacityEffectIntensity) {
        return 0.0;
      }
    }

    // Scan reveal
    if (opacityEffectType == 6) {
      float scan = fract(time * 0.3);
      float yNorm = (vPosition.y + 5.0) / 10.0;
      float reveal = smoothstep(scan - 0.2, scan, yNorm);
      return alpha * mix(1.0, reveal, opacityEffectIntensity);
    }

    // Audio fade
    if (opacityEffectType == 7 && audioEnabled) {
      return alpha * (0.5 + audioLevel * 0.5);
    }

    return alpha;
  }

  // Apply creative effect
  vec4 applyCreativeEffect(vec4 fragColor) {
    if (creativeEffectType == 0) return fragColor;

    float intensity = creativeEffectIntensity;
    vec2 uv = gl_PointCoord;

    // 1: Feedback - echo/ghost effect
    if (creativeEffectType == 1) {
      float echo = sin(time * 5.0 + vPosition.x * 3.0) * 0.5 + 0.5;
      fragColor.rgb = mix(fragColor.rgb, fragColor.rgb * 1.5, echo * intensity);
      fragColor.a *= 0.8 + 0.2 * echo;
    }

    // 2: Kaleidoscope - mirror/reflect colors
    if (creativeEffectType == 2) {
      float angle = atan(vPosition.y, vPosition.x);
      float segments = 6.0;
      float kaleid = abs(mod(angle, 3.14159 / segments) - 3.14159 / segments / 2.0);
      vec3 hsv = rgb2hsv(fragColor.rgb);
      hsv.x = fract(hsv.x + kaleid * intensity);
      fragColor.rgb = hsv2rgb(hsv);
    }

    // 3: Constellation - sparkle/twinkle effect
    if (creativeEffectType == 3) {
      float sparkle = sin(time * 10.0 + vVertexIndex * 0.1) * 0.5 + 0.5;
      float twinkle = pow(sparkle, 3.0);
      fragColor.rgb += vec3(twinkle * intensity);
      fragColor.a = mix(fragColor.a, fragColor.a * (0.5 + twinkle), intensity);
    }

    // 4: Datamosh - glitchy color shifts
    if (creativeEffectType == 4) {
      float glitch = step(0.95, hash(vec2(floor(time * 10.0), vPosition.y)));
      if (glitch > 0.5) {
        fragColor.rgb = fragColor.bgr;
      }
      float shift = hash(vec2(time, vPosition.x)) * intensity * 0.1;
      fragColor.r = fragColor.r + shift;
      fragColor.b = fragColor.b - shift;
    }

    // 5: Pixel sort - brightness-based effect
    if (creativeEffectType == 5) {
      float brightness = dot(fragColor.rgb, vec3(0.299, 0.587, 0.114));
      float sortThreshold = 0.5 + sin(time + vPosition.x) * 0.3;
      if (brightness > sortThreshold) {
        fragColor.rgb *= 1.0 + intensity * 0.5;
      }
    }

    // 6: Echo - multiple ghost layers
    if (creativeEffectType == 6) {
      float layers = 3.0;
      float echoAlpha = 0.0;
      for (float i = 1.0; i <= layers; i++) {
        float delay = i * 0.1;
        float echo = sin((time - delay) * 3.0 + vPosition.x) * 0.5 + 0.5;
        echoAlpha += echo / layers;
      }
      fragColor.a *= 0.7 + 0.3 * echoAlpha * intensity;
    }

    return fragColor;
  }

  void main() {
    if (vDiscard > 0.5) discard;

    vec2 coord = gl_PointCoord - vec2(0.5);
    float dist = length(coord);
    float edgeAlpha = 1.0;

    // Render mode shapes
    // 0: points (circle), 1: gaussians (soft), 2: spheres (3D), 3: billboards (square), 4: cubes (diamond)

    if (renderMode == 0) {
      // Points - hard circle
      if (dist > 0.5) discard;
      edgeAlpha = 1.0 - smoothstep(0.4, 0.5, dist);
    }
    else if (renderMode == 1) {
      // Gaussians - very soft falloff
      float gaussian = exp(-dist * dist * 8.0);
      if (gaussian < 0.01) discard;
      edgeAlpha = gaussian;
    }
    else if (renderMode == 2) {
      // Spheres - 3D shaded look
      if (dist > 0.5) discard;
      float z = sqrt(max(0.0, 0.25 - dist * dist));
      vec3 normal = normalize(vec3(coord, z));
      vec3 light = normalize(vec3(0.5, 0.5, 1.0));
      float diffuse = max(0.0, dot(normal, light));
      edgeAlpha = 0.3 + 0.7 * diffuse;
    }
    else if (renderMode == 3) {
      // Billboards - square
      if (abs(coord.x) > 0.45 || abs(coord.y) > 0.45) discard;
      edgeAlpha = 1.0;
    }
    else if (renderMode == 4) {
      // Cubes - diamond shape
      if (abs(coord.x) + abs(coord.y) > 0.5) discard;
      edgeAlpha = 1.0 - (abs(coord.x) + abs(coord.y)) * 0.5;
    }

    // Get base color
    vec3 color = useOriginalColors ? vColor : mix(colorA / 255.0, colorB / 255.0, colorMix);

    // Apply texture mapping if enabled
    if (textureEnabled) {
      vec2 uv = calculateUV(vPosition);
      vec4 texColor = texture2D(textureMap, uv);
      // Blend texture color with point color based on textureBlend
      // textureBlend = 0: all point color, textureBlend = 1: all texture
      color = mix(color, texColor.rgb, textureBlend * texColor.a);
    }

    // Apply color effect
    color = applyColorEffect(color);

    // Calculate alpha
    float alpha = vAlpha * opacity * edgeAlpha;

    // Apply opacity effect
    alpha = applyOpacityEffect(alpha);

    // Hologram scanlines enhancement
    if (colorEffectType == 4) {
      float scanline = abs(sin(gl_FragCoord.y * 0.5));
      alpha *= 0.7 + scanline * 0.3;
      color += vec3(0.0, 0.1, 0.2) * scanline;
    }

    vec4 fragColor = vec4(color, alpha);

    // Apply creative effect
    fragColor = applyCreativeEffect(fragColor);

    // Handle reveal mode (mouseMode == 3) - fade in points near mouse
    if (mouseMode == 3 && mouseInfluence > 0.0) {
      float revealFactor = 1.0 - smoothstep(0.0, 1.0, vMouseDistance);
      fragColor.a *= revealFactor * mouseInfluence + (1.0 - mouseInfluence);
    }

    gl_FragColor = fragColor;
  }
`;

export class SplatRenderer {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private _width: number = 1920;
  private _height: number = 1080;
  private points: THREE.Points | null = null;
  private geometry: THREE.BufferGeometry | null = null;
  private material: THREE.ShaderMaterial | null = null;
  private startTime: number = 0;
  private plyData: PLYData | null = null;

  // Wireframe rendering
  private wireframe: THREE.LineSegments | null = null;
  private wireframeGeometry: THREE.BufferGeometry | null = null;
  private wireframeMaterial: THREE.LineBasicMaterial | null = null;
  private currentRenderMode: string = 'points';

  // Original positions for animations
  private originalPositions: Float32Array | null = null;
  private velocities: Float32Array | null = null;

  // Mouse tracking
  private mousePosition = new THREE.Vector3();
  private mouseNormalized = new THREE.Vector2();
  // Reusable scratch objects for updateMousePosition — avoids allocating
  // 4 Three.js objects per layer per frame from the canvas render loop.
  private _mouseRaycaster = new THREE.Raycaster();
  private _mouseCamDir = new THREE.Vector3();
  private _mousePlaneNormal = new THREE.Vector3();
  private _mousePlanePoint = new THREE.Vector3();
  private _mousePlane = new THREE.Plane();
  private _mouseIntersection = new THREE.Vector3();
  private pointCloudScale = 1; // Track current scale for mouse radius adjustment
  private positionFitScale = 1;
  private pointCloudBounds = { min: new THREE.Vector3(), max: new THREE.Vector3(), size: 1 };
  private boundMouseMove = (event: MouseEvent) => this.onMouseMove(event);
  private boundMouseLeave = () => {
    this.mousePosition.set(1000, 1000, 1000);
  };

  /**
   * Create a SplatRenderer.
   * @param canvasOrWidth - HTMLCanvasElement for standalone mode, or width (number) for shared-renderer mode
   * @param height - Required when canvasOrWidth is a number
   */
  constructor(canvasOrWidth: HTMLCanvasElement | number, height?: number) {
    // Create scene
    this.scene = new THREE.Scene();
    this.scene.background = null; // Transparent background

    if (typeof canvasOrWidth === 'number') {
      // Shared-renderer mode: no own WebGL context — use renderTo() with main engine's renderer
      const w = canvasOrWidth;
      const h = height || 1080;
      this._width = w;
      this._height = h;
      this.camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 1000);
      this.camera.position.z = 5;
    } else {
      // Standalone mode: creates own WebGL context (used by VJ mode etc.)
      this.canvas = canvasOrWidth;
      this.camera = new THREE.PerspectiveCamera(60, canvasOrWidth.width / canvasOrWidth.height, 0.1, 1000);
      this.camera.position.z = 5;

      this.renderer = new THREE.WebGLRenderer({
        canvas: canvasOrWidth,
        alpha: true,
        antialias: true,
        premultipliedAlpha: false,
        preserveDrawingBuffer: true,
      });
      this.renderer.setSize(canvasOrWidth.width, canvasOrWidth.height, false);
      this.renderer.setPixelRatio(1);

      // Mouse event listeners (only in standalone mode with a real canvas)
      canvasOrWidth.addEventListener('mousemove', this.boundMouseMove);
      canvasOrWidth.addEventListener('mouseleave', this.boundMouseLeave);
    }

    this.startTime = performance.now();
  }

  private onMouseMove(event: MouseEvent) {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const normalizedX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const normalizedY = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.updateMousePosition(normalizedX, normalizedY);
  }

  // Set mouse position from normalized coordinates (-1 to 1)
  // This can be called externally when the splat renderer uses an offscreen canvas
  setMouseNormalized(normalizedX: number, normalizedY: number) {
    this.updateMousePosition(normalizedX, normalizedY);
  }

  // Clear mouse position (move far away)
  clearMousePosition() {
    this.mousePosition.set(1000, 1000, 1000);
  }

  private updateMousePosition(normalizedX: number, normalizedY: number) {
    this.mouseNormalized.x = normalizedX;
    this.mouseNormalized.y = normalizedY;

    this._mouseRaycaster.setFromCamera(this.mouseNormalized, this.camera);
    this.camera.getWorldDirection(this._mouseCamDir);
    this._mousePlaneNormal.copy(this._mouseCamDir).negate();
    this._mousePlanePoint.set(0, 0, 0);
    this._mousePlane.setFromNormalAndCoplanarPoint(this._mousePlaneNormal, this._mousePlanePoint);

    const ray = this._mouseRaycaster.ray;
    if (ray.intersectPlane(this._mousePlane, this._mouseIntersection)) {
      this.mousePosition.copy(this._mouseIntersection);
    } else {
      // Fallback: project along ray at distance to origin
      const distToOrigin = this.camera.position.length();
      this.mousePosition.copy(ray.origin).addScaledVector(ray.direction, distToOrigin);
    }
  }

  // Load point cloud data
  loadData(data: PLYData) {
    this.plyData = data;

    const rawSize = getBoundsSize(data);
    this.positionFitScale = rawSize > 0
      ? clamp(SPLAT_AUTO_FIT_SIZE / rawSize, MIN_AUTO_FIT_SCALE, MAX_AUTO_FIT_SCALE)
      : 1;

    // Calculate fitted bounds for mouse interaction scaling and texture projection.
    const bb = data.boundingBox;
    this.pointCloudBounds.min.set(
      (bb.min.x - data.center.x) * this.positionFitScale,
      (bb.min.y - data.center.y) * this.positionFitScale,
      (bb.min.z - data.center.z) * this.positionFitScale
    );
    this.pointCloudBounds.max.set(
      (bb.max.x - data.center.x) * this.positionFitScale,
      (bb.max.y - data.center.y) * this.positionFitScale,
      (bb.max.z - data.center.z) * this.positionFitScale
    );
    this.pointCloudBounds.size = Math.max(rawSize * this.positionFitScale, 1);
    // Ensure we have a reasonable minimum size
    if (this.pointCloudBounds.size < 0.1) {
      this.pointCloudBounds.size = 1;
    }

    this.createGeometry(data);
  }

  // Get the currently loaded PLY data
  getData(): PLYData | null {
    return this.plyData;
  }

  private createGeometry(data: PLYData) {
    // Dispose old geometry
    if (this.geometry) {
      this.geometry.dispose();
    }
    if (this.material) {
      this.material.dispose();
    }
    if (this.points) {
      this.scene.remove(this.points);
    }

    const vertices = data.vertices;
    const count = vertices.length;

    // Create buffer geometry
    this.geometry = new THREE.BufferGeometry();

    // Position attribute
    const positions = new Float32Array(count * 3);
    this.originalPositions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const alphas = new Float32Array(count);
    const pointScales = new Float32Array(count);
    const indices = new Float32Array(count);
    this.velocities = new Float32Array(count * 3);
    const uvs = new Float32Array(count * 2);

    // Center the point cloud
    const center = data.center;

    for (let i = 0; i < count; i++) {
      const v = vertices[i];
      const i3 = i * 3;

      // Center positions
      positions[i3] = (v.x - center.x) * this.positionFitScale;
      positions[i3 + 1] = (v.y - center.y) * this.positionFitScale;
      positions[i3 + 2] = (v.z - center.z) * this.positionFitScale;

      // Store original positions
      this.originalPositions[i3] = positions[i3];
      this.originalPositions[i3 + 1] = positions[i3 + 1];
      this.originalPositions[i3 + 2] = positions[i3 + 2];

      // Colors (normalized)
      colors[i3] = v.r / 255;
      colors[i3 + 1] = v.g / 255;
      colors[i3 + 2] = v.b / 255;

      // Alpha
      alphas[i] = v.a / 255;

      pointScales[i] = data.dataType === 'gaussian'
        ? getGaussianPointScale(v, this.positionFitScale)
        : 1;

      // Vertex index for effects
      indices[i] = i;

      // Initialize velocities
      this.velocities[i3] = 0;
      this.velocities[i3 + 1] = 0;
      this.velocities[i3 + 2] = 0;

      // UV coordinates from file (if available)
      const i2 = i * 2;
      uvs[i2] = v.texture_u ?? 0;
      uvs[i2 + 1] = v.texture_v ?? 0;
    }

    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute('originalPosition', new THREE.BufferAttribute(this.originalPositions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.geometry.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1));
    this.geometry.setAttribute('pointScale', new THREE.BufferAttribute(pointScales, 1));
    this.geometry.setAttribute('vertexIndex', new THREE.BufferAttribute(indices, 1));
    this.geometry.setAttribute('velocity', new THREE.BufferAttribute(this.velocities, 3));
    this.geometry.setAttribute('texUV', new THREE.BufferAttribute(uvs, 2));

    // Create shader material
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: this.createUniforms(),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    // Create points
    this.points = new THREE.Points(this.geometry, this.material);
    this.scene.add(this.points);

    // Create wireframe geometry
    this.createWireframeGeometry(data, positions, colors);
  }

  // Create wireframe geometry connecting nearby points
  private createWireframeGeometry(data: PLYData, positions: Float32Array, colors: Float32Array) {
    // Dispose old wireframe
    if (this.wireframeGeometry) {
      this.wireframeGeometry.dispose();
    }
    if (this.wireframeMaterial) {
      this.wireframeMaterial.dispose();
    }
    if (this.wireframe) {
      this.scene.remove(this.wireframe);
    }

    const count = data.vertices.length;
    if (count < 2) return;

    // Calculate adaptive distance threshold based on the fitted point cloud size.
    const size = this.pointCloudBounds.size;
    // Connect points within ~2% of the total size, with a max of ~10 connections per point
    const distThreshold = size * 0.025;
    const distThresholdSq = distThreshold * distThreshold;

    // Build lines connecting nearby points
    // For performance, limit how many neighbors we check
    const lineIndices: number[] = [];
    const maxConnections = 8; // Max connections per point
    const connectionCount = new Uint8Array(count);

    // Simple spatial grid for faster neighbor lookup
    const gridSize = distThreshold * 2;
    const grid = new Map<string, number[]>();

    // Build grid
    for (let i = 0; i < count; i++) {
      const x = positions[i * 3];
      const y = positions[i * 3 + 1];
      const z = positions[i * 3 + 2];
      const gx = Math.floor(x / gridSize);
      const gy = Math.floor(y / gridSize);
      const gz = Math.floor(z / gridSize);
      const key = `${gx},${gy},${gz}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key)!.push(i);
    }

    // Find nearby points and create lines
    for (let i = 0; i < count; i++) {
      if (connectionCount[i] >= maxConnections) continue;

      const x1 = positions[i * 3];
      const y1 = positions[i * 3 + 1];
      const z1 = positions[i * 3 + 2];
      const gx = Math.floor(x1 / gridSize);
      const gy = Math.floor(y1 / gridSize);
      const gz = Math.floor(z1 / gridSize);

      // Check neighboring cells
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            const key = `${gx + dx},${gy + dy},${gz + dz}`;
            const cell = grid.get(key);
            if (!cell) continue;

            for (const j of cell) {
              if (j <= i) continue; // Avoid duplicates
              if (connectionCount[i] >= maxConnections || connectionCount[j] >= maxConnections) continue;

              const x2 = positions[j * 3];
              const y2 = positions[j * 3 + 1];
              const z2 = positions[j * 3 + 2];

              const dx2 = x2 - x1;
              const dy2 = y2 - y1;
              const dz2 = z2 - z1;
              const distSq = dx2 * dx2 + dy2 * dy2 + dz2 * dz2;

              if (distSq < distThresholdSq && distSq > 0.0001) {
                lineIndices.push(i, j);
                connectionCount[i]++;
                connectionCount[j]++;
              }
            }
          }
        }
      }
    }

    if (lineIndices.length === 0) return;

    // Create line geometry
    this.wireframeGeometry = new THREE.BufferGeometry();

    // Create position and color arrays for lines
    const linePositions = new Float32Array(lineIndices.length * 3);
    const lineColors = new Float32Array(lineIndices.length * 3);

    for (let i = 0; i < lineIndices.length; i++) {
      const idx = lineIndices[i];
      linePositions[i * 3] = positions[idx * 3];
      linePositions[i * 3 + 1] = positions[idx * 3 + 1];
      linePositions[i * 3 + 2] = positions[idx * 3 + 2];
      lineColors[i * 3] = colors[idx * 3];
      lineColors[i * 3 + 1] = colors[idx * 3 + 1];
      lineColors[i * 3 + 2] = colors[idx * 3 + 2];
    }

    this.wireframeGeometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
    this.wireframeGeometry.setAttribute('color', new THREE.BufferAttribute(lineColors, 3));

    // Create line material
    this.wireframeMaterial = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
    });

    // Create line segments
    this.wireframe = new THREE.LineSegments(this.wireframeGeometry, this.wireframeMaterial);
    this.wireframe.visible = false; // Hidden by default
    this.scene.add(this.wireframe);
  }

  private createUniforms(): Record<string, THREE.IUniform> {
    return {
      time: { value: 0 },
      pointSize: { value: 3 },
      sizeAttenuation: { value: true },
      opacity: { value: 1 },
      renderMode: { value: 0 },

      // Animation
      animationProgress: { value: 0 },
      animationIntensity: { value: 1 },
      animationType: { value: 0 },
      explodeForce: { value: 1 },
      voxelGridSize: { value: 16 },
      peelAxis: { value: new THREE.Vector3(0, 1, 0) },
      gravity: { value: 9.8 },
      turbulence: { value: 0 },

      // Displacement
      displacementType: { value: 0 },
      displacementAmount: { value: 0.5 },
      noiseScale: { value: 2 },
      noiseSpeed: { value: 1 },
      waveFrequency: { value: 2 },
      waveAmplitude: { value: 0.3 },
      glitchIntensity: { value: 0.5 },
      windDirection: { value: new THREE.Vector3(1, 0, 0) },
      windStrength: { value: 0.5 },

      // Audio
      audioEnabled: { value: false },
      audioLevel: { value: 0 },
      audioDisplacement: { value: 0.5 },
      audioScale: { value: 0.3 },
      audioColor: { value: 0.5 },
      beatIntensity: { value: 0 },
      beatPhase: { value: 0 },

      // Transform
      scaleUniform: { value: 1 },
      rotation3D: { value: new THREE.Vector3(0, 0, 0) },
      position3D: { value: new THREE.Vector3(0, 0, 0) },

      // Slice plane
      sliceEnabled: { value: false },
      sliceAxis: { value: new THREE.Vector3(0, 1, 0) },
      slicePosition: { value: 0 },
      sliceThickness: { value: 0.1 },

      // Mouse
      mousePosition: { value: new THREE.Vector3(1000, 1000, 1000) },
      mouseInfluence: { value: 0 },
      mouseRadius: { value: 0.2 },
      mouseMode: { value: 0 },

      // Color effects
      colorEffectType: { value: 0 },
      colorEffectIntensity: { value: 1 },
      hueShift: { value: 0 },
      useOriginalColors: { value: true },
      colorA: { value: new THREE.Vector3(255, 255, 255) },
      colorB: { value: new THREE.Vector3(100, 200, 255) },
      colorMix: { value: 0 },
      hologramSpeed: { value: 2 },
      hologramDensity: { value: 20 },

      // Opacity effects
      opacityEffectType: { value: 0 },
      opacityEffectIntensity: { value: 1 },
      dofFocalDistance: { value: 0.5 },
      dofBlurAmount: { value: 0.5 },
      fogDensity: { value: 0.3 },
      fogColor: { value: new THREE.Vector3(50, 50, 80) },
      pulseSpeed: { value: 1 },
      dissolveProgress: { value: 0 },

      // Creative effects
      creativeEffectType: { value: 0 },
      creativeEffectIntensity: { value: 1 },
      trailLength: { value: 0.5 },

      // Texture mapping
      textureEnabled: { value: false },
      textureMap: { value: null },
      textureBlend: { value: 0.5 },
      textureProjection: { value: 0 },
      textureScale: { value: 1 },
      textureOffset: { value: new THREE.Vector2(0, 0) },
      pointCloudMin: { value: new THREE.Vector3(-1, -1, -1) },
      pointCloudMax: { value: new THREE.Vector3(1, 1, 1) },
    };
  }

  // Texture for mapping
  private textureMap: THREE.Texture | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private currentTexturePath: string = '';

  // Set texture from image data URL or video element
  setTexture(dataUrl: string, type: 'image' | 'video' = 'image') {
    if (dataUrl === this.currentTexturePath) return;
    this.currentTexturePath = dataUrl;

    // Dispose old texture
    if (this.textureMap) {
      this.textureMap.dispose();
      this.textureMap = null;
    }

    // Clean up old video element
    if (this.videoElement) {
      this.videoElement.pause();
      this.videoElement.src = '';
      this.videoElement = null;
    }

    if (!dataUrl) {
      if (this.material) {
        this.material.uniforms.textureEnabled.value = false;
        this.material.uniforms.textureMap.value = null;
      }
      return;
    }

    if (type === 'video') {
      // Create video element and video texture
      const video = document.createElement('video');
      video.src = dataUrl;
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      video.crossOrigin = 'anonymous';

      video.addEventListener('loadeddata', () => {
        const videoTexture = new THREE.VideoTexture(video);
        videoTexture.minFilter = THREE.LinearFilter;
        videoTexture.magFilter = THREE.LinearFilter;
        videoTexture.format = THREE.RGBAFormat;
        this.textureMap = videoTexture;
        this.videoElement = video;

        if (this.material) {
          this.material.uniforms.textureMap.value = videoTexture;
        }

        video.play().catch(e => console.warn('Video autoplay blocked:', e));
      });

      video.load();
    } else {
      // Create image texture
      const loader = new THREE.TextureLoader();
      loader.load(
        dataUrl,
        (texture) => {
          texture.minFilter = THREE.LinearFilter;
          texture.magFilter = THREE.LinearFilter;
          this.textureMap = texture;

          if (this.material) {
            this.material.uniforms.textureMap.value = texture;
          }
        },
        undefined,
        (err) => console.error('Failed to load texture:', err)
      );
    }
  }

  // Update video texture each frame if needed
  private updateVideoTexture() {
    if (this.videoElement && this.textureMap && !this.videoElement.paused) {
      (this.textureMap as THREE.VideoTexture).needsUpdate = true;
    }
  }

  // Update from SplatContent (audioState provides beat/phase data for enhanced reactivity)
  update(content: SplatContent, audioLevel: number = 0, audioState?: any) {
    if (!this.material) return;

    const time = (performance.now() - this.startTime) / 1000;
    const u = this.material.uniforms;

    // Time
    u.time.value = time;

    // Point rendering
    u.pointSize.value = content.pointSize;
    u.sizeAttenuation.value = content.pointSizeAttenuation;
    u.opacity.value = content.opacity;
    u.renderMode.value = this.getRenderModeIndex(content.renderMode);

    // Toggle between points and wireframe based on render mode
    const isWireframe = content.renderMode === 'wireframe';
    if (this.points) {
      this.points.visible = !isWireframe;
    }
    if (this.wireframe) {
      this.wireframe.visible = isWireframe;
      // Update wireframe opacity
      if (this.wireframeMaterial) {
        this.wireframeMaterial.opacity = content.opacity;
      }
    }
    this.currentRenderMode = content.renderMode;

    // Point density - use drawRange to limit rendered points
    if (this.geometry && this.plyData) {
      const totalPoints = this.plyData.vertices.length;
      const density = content.pointDensity ?? 1;
      const activeCount = Math.max(1, Math.floor(totalPoints * density));
      this.geometry.setDrawRange(0, activeCount);
    }

    // Animation
    u.animationType.value = this.getAnimationTypeIndex(content.animationType);
    // For looping: use smooth continuous formula (sin-based oscillation 0->1->0)
    // This avoids the jarring jump from 1 back to 0
    u.animationProgress.value = content.animationLoop
      ? (0.5 - 0.5 * Math.cos(time * content.animationSpeed * Math.PI * 2))
      : content.animationProgress;
    u.animationIntensity.value = content.animationIntensity;
    u.explodeForce.value = content.explodeForce;
    u.voxelGridSize.value = content.voxelGridSize;
    u.peelAxis.value.set(
      content.peelAxis === 'x' ? 1 : 0,
      content.peelAxis === 'y' ? 1 : 0,
      content.peelAxis === 'z' ? 1 : 0
    );
    u.gravity.value = content.physics.gravity;
    u.turbulence.value = content.physics.turbulence;

    // Displacement
    u.displacementType.value = this.getDisplacementTypeIndex(content.displacementType);
    u.displacementAmount.value = content.displacementAmount;
    u.noiseScale.value = content.noiseScale;
    u.noiseSpeed.value = content.noiseSpeed;
    u.waveFrequency.value = content.waveFrequency;
    u.waveAmplitude.value = content.waveAmplitude;
    u.glitchIntensity.value = content.glitchIntensity;
    u.windDirection.value.set(
      content.windDirection.x,
      content.windDirection.y,
      content.windDirection.z
    );
    u.windStrength.value = content.windStrength;

    // Audio
    u.audioEnabled.value = content.audioEnabled;
    u.audioLevel.value = audioLevel;
    u.audioDisplacement.value = content.audioDisplacement;
    u.audioScale.value = content.audioScale;
    u.audioColor.value = content.audioColor;
    // Beat reactivity from full audio state
    u.beatIntensity.value = typeof audioState?.beat === 'number'
      ? audioState.beat
      : (audioState?.beat?.beatIntensity || 0);
    u.beatPhase.value = audioState?.beatPhase || 0;

    // Transform
    u.scaleUniform.value = content.scaleUniform;
    u.rotation3D.value.set(
      content.rotationX * Math.PI / 180,
      content.rotationY * Math.PI / 180,
      content.rotationZ * Math.PI / 180
    );
    u.position3D.value.set(content.positionX, content.positionY, content.positionZ);

    // Slice plane
    u.sliceEnabled.value = content.slicePlane.enabled;
    u.sliceAxis.value.set(
      content.slicePlane.axis === 'x' ? 1 : 0,
      content.slicePlane.axis === 'y' ? 1 : 0,
      content.slicePlane.axis === 'z' ? 1 : 0
    );
    u.slicePosition.value = content.slicePlane.animated
      ? Math.sin(time * content.slicePlane.speed) * 2
      : content.slicePlane.position * 2;
    u.sliceThickness.value = content.slicePlane.thickness * 4;

    // Mouse - scale radius based on point cloud size for intuitive interaction
    // Store scale for mouse calculations
    this.pointCloudScale = content.scaleUniform;
    u.mousePosition.value.copy(this.mousePosition);
    u.mouseInfluence.value = content.mouseInfluence;
    // Scale mouse radius relative to the point cloud size (0-1 slider maps to 0-50% of cloud size)
    const baseRadius = this.pointCloudBounds.size * content.scaleUniform * 0.5;
    u.mouseRadius.value = content.mouseRadius * baseRadius;
    u.mouseMode.value = this.getMouseModeIndex(content.mouseMode);

    // Color effects
    u.colorEffectType.value = this.getColorEffectIndex(content.colorEffectType);
    u.colorEffectIntensity.value = content.colorEffectIntensity;
    u.hueShift.value = content.hueShift;
    u.useOriginalColors.value = content.useOriginalColors;
    u.colorA.value.set(content.colorA[0], content.colorA[1], content.colorA[2]);
    u.colorB.value.set(content.colorB[0], content.colorB[1], content.colorB[2]);
    u.colorMix.value = content.colorMix;
    u.hologramSpeed.value = content.hologramSpeed;
    u.hologramDensity.value = content.hologramDensity;

    // Opacity effects
    u.opacityEffectType.value = this.getOpacityEffectIndex(content.opacityEffectType);
    u.opacityEffectIntensity.value = content.opacityEffectIntensity;
    u.dofFocalDistance.value = content.dofFocalDistance;
    u.dofBlurAmount.value = content.dofBlurAmount;
    u.fogDensity.value = content.fogDensity;
    u.fogColor.value.set(content.fogColor[0], content.fogColor[1], content.fogColor[2]);
    u.pulseSpeed.value = content.pulseSpeed;
    u.dissolveProgress.value = content.dissolveProgress;

    // Creative effects
    u.creativeEffectType.value = this.getCreativeEffectIndex(content.creativeEffectType);
    u.creativeEffectIntensity.value = content.creativeEffectIntensity;
    u.trailLength.value = content.trailLength;

    // Texture mapping
    u.textureEnabled.value = content.textureEnabled && this.textureMap !== null;
    u.textureBlend.value = content.textureBlend;
    u.textureProjection.value = this.getTextureProjectionIndex(content.textureProjection);
    u.textureScale.value = content.textureScale ?? 1;
    u.textureOffset.value.set(content.textureOffsetX ?? 0, content.textureOffsetY ?? 0);

    // Set bounding box for UV calculations
    u.pointCloudMin.value.copy(this.pointCloudBounds.min);
    u.pointCloudMax.value.copy(this.pointCloudBounds.max);

    // Update video texture if playing
    this.updateVideoTexture();

    // Update camera
    this.updateCamera(content);
  }

  private getTextureProjectionIndex(projection: string | undefined): number {
    const projections = ['spherical', 'cylindrical', 'planarXY', 'planarXZ', 'planarYZ', 'box', 'native'];
    const idx = projections.indexOf(projection || 'spherical');
    return idx >= 0 ? idx : 0;
  }

  private updateCamera(content: SplatContent) {
    // Use flattened camera properties
    this.camera.fov = content.cameraFov;
    this.camera.updateProjectionMatrix();

    // Apply orbit
    const distance = content.cameraDistance;
    const orbitX = content.cameraOrbitX * Math.PI / 180;
    const orbitY = content.cameraOrbitY * Math.PI / 180;
    const roll = (content.cameraRoll ?? 0) * Math.PI / 180;

    // Auto-rotate
    let yRotation = orbitY;
    if (content.autoRotate) {
      yRotation += (performance.now() - this.startTime) / 1000 * content.autoRotateSpeed * Math.PI / 180;
    }

    // Calculate camera position from orbit angles (looking at origin)
    const camX = Math.sin(yRotation) * Math.cos(orbitX) * distance;
    const camY = Math.sin(orbitX) * distance;
    const camZ = Math.cos(yRotation) * Math.cos(orbitX) * distance;

    // Set camera position and look at origin first
    this.camera.position.set(camX, camY, camZ);
    this.camera.lookAt(0, 0, 0);

    // Apply camera roll (Z rotation) after lookAt
    this.camera.rotation.z = roll;

    // Now apply pan as a view offset - this shifts what we see without rotating
    // Pan is applied in screen space by adjusting the projection matrix offset
    const panX = (content.cameraPanX ?? 0) * 0.02; // Scale for reasonable movement
    const panY = (content.cameraPanY ?? 0) * 0.02;

    // Set the camera's view offset for true screen-space panning
    // This shifts the rendered view without changing camera orientation
    if (panX !== 0 || panY !== 0) {
      const width = this.canvas ? this.canvas.width : this._width;
      const height = this.canvas ? this.canvas.height : this._height;
      // setViewOffset(fullWidth, fullHeight, offsetX, offsetY, width, height)
      // Using offsets as fractions of the view
      this.camera.setViewOffset(
        width, height,
        -panX * width, // negative because we want right = positive X on screen
        panY * height,  // positive because we want up = positive Y on screen
        width, height
      );
      this.camera.updateProjectionMatrix();
    } else {
      // Clear any view offset when pan is zero
      this.camera.clearViewOffset();
      this.camera.updateProjectionMatrix();
    }
  }

  private getAnimationTypeIndex(type: SplatAnimationType): number {
    const types: SplatAnimationType[] = [
      'none', 'explode', 'implode', 'slice', 'voxelSnap', 'peel',
      'gravity', 'swarm', 'morph', 'orbit', 'wave3d', 'scatter', 'spiral'
    ];
    return types.indexOf(type);
  }

  private getDisplacementTypeIndex(type: SplatDisplacementType): number {
    const types: SplatDisplacementType[] = [
      'none', 'noise', 'audioReactive', 'wave', 'glitch', 'wind', 'magnetic', 'ripple'
    ];
    return types.indexOf(type);
  }

  private getRenderModeIndex(mode: string): number {
    const modes = ['points', 'gaussians', 'spheres', 'billboards', 'cubes'];
    return Math.max(0, modes.indexOf(mode));
  }

  private getColorEffectIndex(type: SplatColorEffectType): number {
    const types: SplatColorEffectType[] = [
      'none', 'chromatic', 'heatmap', 'pointillist', 'hologram', 'rainbow', 'audioColor', 'depthGradient',
      'neon', 'pastel', 'cyberpunk', 'fire', 'ice'
    ];
    const idx = types.indexOf(type);
    return idx >= 0 ? idx : 0;
  }

  private getOpacityEffectIndex(type: SplatOpacityEffectType): number {
    const types: SplatOpacityEffectType[] = [
      'none', 'dof', 'fog', 'pulse', 'proximity', 'dissolve', 'scanReveal', 'audioFade'
    ];
    return types.indexOf(type);
  }

  private getCreativeEffectIndex(type: SplatCreativeEffectType): number {
    const types: SplatCreativeEffectType[] = [
      'none', 'feedback', 'kaleidoscope', 'constellation', 'datamosh', 'pixelSort', 'echo'
    ];
    return types.indexOf(type);
  }

  private getMouseModeIndex(mode: string): number {
    const modes = ['attract', 'repel', 'swirl', 'reveal'];
    return modes.indexOf(mode);
  }

  render() {
    if (this.renderer) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  /** Render this splat scene to an external WebGLRenderTarget using a shared renderer.
   *  This avoids cross-context issues by keeping everything in one WebGL context. */
  renderTo(externalRenderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget) {
    externalRenderer.setRenderTarget(target);
    externalRenderer.setClearColor(0x000000, 0); // transparent clear
    externalRenderer.clear();
    externalRenderer.render(this.scene, this.camera);
    externalRenderer.setRenderTarget(null);
  }

  resize(width: number, height: number) {
    this._width = width;
    this._height = height;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    if (this.renderer) {
      this.renderer.setSize(width, height, false);
    }
  }

  dispose() {
    if (this.geometry) this.geometry.dispose();
    if (this.material) this.material.dispose();
    if (this.points) this.scene.remove(this.points);
    if (this.wireframeGeometry) this.wireframeGeometry.dispose();
    if (this.wireframeMaterial) this.wireframeMaterial.dispose();
    if (this.wireframe) this.scene.remove(this.wireframe);
    if (this.textureMap) this.textureMap.dispose();
    if (this.videoElement) {
      this.videoElement.pause();
      this.videoElement.src = '';
    }
    if (this.renderer) this.renderer.dispose();

    if (this.canvas) {
      this.canvas.removeEventListener('mousemove', this.boundMouseMove);
      this.canvas.removeEventListener('mouseleave', this.boundMouseLeave);
    }
  }

  // Get the WebGL context for texture reading
  getContext(): WebGLRenderingContext | WebGL2RenderingContext | null {
    return this.renderer ? this.renderer.getContext() : null;
  }

  // Get the canvas
  getCanvas(): HTMLCanvasElement | null {
    return this.canvas;
  }
}
