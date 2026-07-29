// Splat Renderer - Three.js based point cloud and gaussian splat renderer
// Implements all animations, effects, and interactions for splat layers

import * as THREE from 'three';
import type { PLYData } from './plyLoader';
import type {
  SplatContent,
  SplatAnimationType,
  SplatDisplacementType,
  SplatColorEffectType,
  SplatOpacityEffectType,
  SplatCreativeEffectType,
} from '../types';
import {
  composeSplatRotationRadians,
  computeSplatNormalization,
  hexToRgb01,
  normalizedGaussianScale,
  normalizedSplatPosition,
  resolveSplatCameraDistance,
} from './splatTransform';
import { resolveSplatAnimationClock, smoothSplatAudio } from './splatMotion';

export function requiresAdvancedSplatMaterial(content: SplatContent): boolean {
  const colorEffect = content.colorEffectType ?? content.colorEffect ?? 'none';
  const opacityEffect = content.opacityEffectType ?? content.opacityEffect ?? 'none';
  const creativeEffect = content.creativeEffectType ?? content.creativeEffect ?? 'none';

  return (
    (content.animationType ?? 'none') !== 'none' ||
    (content.displacementType ?? 'none') !== 'none' ||
    (content.audioEnabled ?? false) ||
    (content.slicePlane?.enabled ?? false) ||
    (content.mouseInfluence ?? 0) > 0 ||
    colorEffect !== 'none' ||
    (content.hueShift ?? 0) !== 0 ||
    opacityEffect !== 'none' ||
    creativeEffect !== 'none' ||
    (content.textureEnabled ?? false) ||
    (content.atmosphereEnabled ?? false)
  );
}

// The normal point/splat view deliberately uses a compact shader. Keeping the
// optional motion and effects suite out of this program lets multi-million
// point architectural captures render without compiling or scheduling every
// advanced branch on the GPU.
export const baselineVertexShader = `
  uniform float pointSize;
  uniform float maxPointSize;
  uniform bool sizeAttenuation;
  uniform float scaleUniform;
  uniform vec3 rotation3D;
  uniform vec3 position3D;

  attribute vec3 originalPosition;
  attribute vec3 color;
  attribute float alpha;
  attribute float gaussianScale;
  attribute vec3 gaussianShape;

  varying vec3 vColor;
  varying float vAlpha;
  varying vec3 vGaussianShape;

  void main() {
    vColor = color;
    vAlpha = alpha;
    vGaussianShape = gaussianShape;

    vec3 pos = originalPosition * scaleUniform;
    float cx = cos(rotation3D.x);
    float sx = sin(rotation3D.x);
    float cy = cos(rotation3D.y);
    float sy = sin(rotation3D.y);
    float cz = cos(rotation3D.z);
    float sz = sin(rotation3D.z);
    mat3 rotX = mat3(1, 0, 0, 0, cx, -sx, 0, sx, cx);
    mat3 rotY = mat3(cy, 0, sy, 0, 1, 0, -sy, 0, cy);
    mat3 rotZ = mat3(cz, -sz, 0, sz, cz, 0, 0, 0, 1);
    pos = rotZ * rotY * rotX * pos + position3D;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    float size = pointSize * gaussianScale;
    if (sizeAttenuation) {
      size *= 300.0 / max(-mvPosition.z, 0.001);
    }
    gl_PointSize = clamp(size, 0.0, maxPointSize);
  }
`;

export const baselineFragmentShader = `
  uniform float opacity;
  uniform int renderMode;
  uniform bool useOriginalColors;
  uniform vec3 colorA;
  uniform vec3 colorB;
  uniform float colorMix;

  varying vec3 vColor;
  varying float vAlpha;
  varying vec3 vGaussianShape;

  void main() {
    vec2 coord = gl_PointCoord - vec2(0.5);
    float dist = length(coord);
    float edgeAlpha = 1.0;

    if (renderMode == 0) {
      if (dist > 0.5) discard;
      edgeAlpha = 1.0 - smoothstep(0.4, 0.5, dist);
    } else if (renderMode == 1) {
      vec2 rotated = vec2(
        coord.x * vGaussianShape.y + coord.y * vGaussianShape.z,
        -coord.x * vGaussianShape.z + coord.y * vGaussianShape.y
      );
      rotated.y /= max(vGaussianShape.x, 0.08);
      float gaussian = exp(-dot(rotated, rotated) * 10.0);
      if (gaussian < 0.01) discard;
      edgeAlpha = gaussian;
    } else if (renderMode == 2) {
      if (dist > 0.5) discard;
      float normalZ = sqrt(max(0.0, 1.0 - dot(coord * 2.0, coord * 2.0)));
      vec3 normal = normalize(vec3(coord * 2.0, normalZ));
      float diffuse = max(0.0, dot(normal, normalize(vec3(0.5, 0.5, 1.0))));
      edgeAlpha = 0.3 + 0.7 * diffuse;
    } else if (renderMode == 3) {
      if (abs(coord.x) > 0.45 || abs(coord.y) > 0.45) discard;
    } else if (renderMode == 4) {
      float diamond = abs(coord.x) + abs(coord.y);
      if (diamond > 0.5) discard;
      edgeAlpha = 1.0 - diamond * 0.5;
    }

    vec3 color = useOriginalColors
      ? vColor
      : mix(colorA / 255.0, colorB / 255.0, colorMix);

    gl_FragColor = vec4(color, vAlpha * opacity * edgeAlpha);
  }
`;

// Vertex shader for point cloud rendering with all effects
export const vertexShader = `
  uniform float time;
  uniform float pointSize;
  uniform float maxPointSize;
  uniform bool sizeAttenuation;

  // Animation uniforms
  uniform float animationProgress;
  uniform float animationPhase;
  uniform float animationIntensity;
  uniform int animationType;
  uniform float explodeForce;
  uniform float explodeTurbulence;
  uniform float implodeForce;
  uniform float implodeSpin;
  uniform float voxelGridSize;
  uniform vec3 peelAxis;
  uniform float peelDirection;
  uniform float peelWidth;
  uniform float peelCurl;
  uniform float sliceWidth;
  uniform float sliceSoftness;
  uniform float sliceTravel;
  uniform vec3 waveAxis;
  uniform float animationWaveFrequency;
  uniform float animationWaveAmplitude;
  uniform float scatterDistance;
  uniform float scatterRandomness;
  uniform float spiralRadius;
  uniform float spiralTurns;
  uniform float spiralLift;
  uniform float swarmCohesion;
  uniform float swarmSeparation;
  uniform float swarmAlignment;
  uniform float gravityStrength;
  uniform float gravitySpread;
  uniform float gravityFloor;
  uniform float turntableTilt;
  uniform float tumbleSpread;
  uniform float breatheAmount;
  uniform float driftAmount;
  uniform float vortexTwist;
  uniform float morphRoundness;
  uniform float gravity;
  uniform float turbulence;

  // Displacement uniforms
  uniform int displacementType;
  uniform float displacementAmount;
  uniform float displacementScale;
  uniform float displacementSpeed;
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

  // Lighting and atmosphere
  uniform bool lightingEnabled;
  uniform float ambientIntensity;
  uniform vec3 keyLightColor;
  uniform float keyLightIntensity;
  uniform vec3 keyLightDirection;
  uniform vec3 rimLightColor;
  uniform float rimLightIntensity;
  uniform vec3 rimLightDirection;
  uniform float shadowStrength;
  uniform float shadowSoftness;
  uniform float specularStrength;
  uniform bool atmosphereEnabled;
  uniform float atmosphereDensity;
  uniform vec3 atmosphereColor;
  uniform float atmosphereScale;
  uniform float atmosphereTurbulence;
  uniform float atmosphereSpeed;

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
  attribute float vertexIndex;
  attribute vec3 velocity;
  attribute vec2 texUV;
  attribute float gaussianScale;
  attribute vec3 gaussianShape;

  varying vec3 vColor;
  varying float vAlpha;
  varying float vDiscard;
  varying vec3 vPosition;
  varying float vVertexIndex;
  varying float vMouseDistance; // For reveal effect in fragment shader
  varying vec2 vTexUV;
  varying vec3 vGaussianShape;

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
    float progress = clamp(animationProgress, 0.0, 1.0);
    float t = progress * animationIntensity;
    vec3 radial = normalize(origPos + vec3(0.0001));

    // Explode - coherent radial burst with controllable turbulent breakup.
    if (animationType == 1) {
      vec3 breakup = vec3(
        snoise(origPos * 2.7 + vec3(19.0, 0.0, animationPhase * 0.12)),
        snoise(origPos * 2.7 + vec3(0.0, 43.0, animationPhase * 0.15)),
        snoise(origPos * 2.7 + vec3(animationPhase * 0.1, 0.0, 71.0))
      );
      return pos + (radial + breakup * explodeTurbulence) * t * explodeForce;
    }

    // Implode - collapse inward while winding into the center.
    if (animationType == 2) {
      float collapse = clamp(t * implodeForce, 0.0, 0.995);
      vec3 collapsed = pos * (1.0 - collapse);
      float angle = t * implodeSpin * (1.0 + length(origPos.xz));
      float c = cos(angle);
      float s = sin(angle);
      return vec3(c * collapsed.x + s * collapsed.z, collapsed.y, -s * collapsed.x + c * collapsed.z);
    }

    // Slice - traveling bands offset alternating slabs without discarding points.
    if (animationType == 3) {
      vec3 axis = normalize(peelAxis + vec3(0.0001));
      float axisPosition = dot(origPos, axis);
      float travel = animationPhase * sliceTravel;
      float bandCoord = axisPosition * max(sliceWidth, 0.05) - travel;
      float slab = floor(bandCoord);
      float edge = abs(fract(bandCoord) - 0.5) * 2.0;
      float bandMask = 1.0 - smoothstep(
        clamp(sliceSoftness, 0.001, 0.99),
        1.0,
        edge
      );
      float direction = mod(abs(slab), 2.0) < 1.0 ? -1.0 : 1.0;
      vec3 tangent = normalize(cross(axis, abs(axis.y) > 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0)));
      return pos + tangent * direction * bandMask * t * 0.65;
    }

    // Voxel snap - points snap to grid
    if (animationType == 4) {
      vec3 gridPos = floor(origPos * voxelGridSize + 0.5) / voxelGridSize;
      return mix(origPos, gridPos, t);
    }

    // Peel - a traveling curl front that rolls points away instead of deleting them.
    if (animationType == 5) {
      vec3 axis = normalize(peelAxis + vec3(0.0001));
      float axisPosition = dot(origPos, axis) * peelDirection;
      float front = mix(-2.5, 2.5, progress);
      float behindFront = front - axisPosition;
      float peelMask = smoothstep(0.0, max(peelWidth, 0.01), behindFront)
        * (1.0 - smoothstep(max(peelWidth, 0.01), max(peelWidth, 0.01) * 2.0, behindFront));
      vec3 tangent = normalize(cross(axis, abs(axis.z) > 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, 1.0)));
      float curlAngle = peelMask * peelCurl * animationIntensity;
      return pos + tangent * sin(curlAngle) * peelWidth + axis * (1.0 - cos(curlAngle)) * peelWidth;
    }

    // Gravity - staggered fall with lateral spread and a configurable floor.
    if (animationType == 6) {
      float delay = fract(sin(vertexIndex * 12.9898) * 43758.5453) * 0.35;
      float fallTime = max(0.0, progress - delay) * animationIntensity;
      vec2 spread = vec2(
        snoise(origPos * 2.0 + vec3(13.0, animationPhase * 0.08, 0.0)),
        snoise(origPos * 2.0 + vec3(0.0, animationPhase * 0.08, 37.0))
      ) * gravitySpread;
      vec3 fallen = pos + vec3(spread.x, -gravityStrength * fallTime * fallTime, spread.y) * t;
      fallen.y = max(fallen.y, gravityFloor);
      return fallen;
    }

    // Swarm - flocking behavior with noise-driven velocity fields
    if (animationType == 7) {
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
      vec3 swarmOffset = (
        toCenter * swarmCohesion
        + separation * swarmSeparation
        + flow * swarmAlignment
      ) * t * max(turbulence, 0.1);
      return pos + swarmOffset;
    }

    // Morph - points transition toward a sphere surface
    if (animationType == 8) {
      // Calculate target position on a sphere
      float radius = mix(length(origPos), max(length(origPos), 0.75), morphRoundness);
      vec3 spherePos = normalize(origPos + vec3(0.0001)) * radius;
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

    // Turntable - rigid, continuous rotation around the vertical axis
    if (animationType == 9) {
      float tilt = turntableTilt;
      vec3 tilted = vec3(pos.x, cos(tilt) * pos.y - sin(tilt) * pos.z, sin(tilt) * pos.y + cos(tilt) * pos.z);
      float angle = animationPhase * animationIntensity;
      float c = cos(angle);
      float s = sin(angle);
      return vec3(c * tilted.x + s * tilted.z, tilted.y, -s * tilted.x + c * tilted.z);
    }

    // Wave 3D - directional wave field with independent frequency and amplitude.
    if (animationType == 10) {
      vec3 axis = normalize(waveAxis + vec3(0.0001));
      vec3 travelAxis = normalize(cross(axis, abs(axis.y) > 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0)));
      float phase = dot(origPos, travelAxis) * animationWaveFrequency - animationPhase * 2.0;
      float wave = sin(phase) * animationWaveAmplitude * animationIntensity;
      return pos + axis * wave;
    }

    // Scatter - stable per-point offsets so it reads as dispersion, not noise drift.
    if (animationType == 11) {
      vec3 scatter = vec3(
        snoise(origPos * scatterRandomness + vec3(11.0, 0.0, 0.0)),
        snoise(origPos * scatterRandomness + vec3(0.0, 29.0, 0.0)),
        snoise(origPos * scatterRandomness + vec3(0.0, 0.0, 47.0))
      );
      return pos + normalize(scatter + vec3(0.0001)) * t * scatterDistance;
    }

    // Spiral - wind the existing cloud around Y with radial expansion and lift.
    if (animationType == 12) {
      float baseAngle = atan(pos.z, pos.x);
      float radius = length(pos.xz) + t * spiralRadius;
      float angle = baseAngle + animationPhase * spiralTurns + pos.y * spiralTurns * 0.35;
      return vec3(cos(angle) * radius, pos.y + t * spiralLift, sin(angle) * radius);
    }

    // Tumble - continuous multi-axis rigid rotation
    if (animationType == 13) {
      float ax = animationPhase * 0.37 * animationIntensity * tumbleSpread;
      float ay = animationPhase * 0.61 * animationIntensity * tumbleSpread;
      float az = animationPhase * 0.23 * animationIntensity * tumbleSpread;
      mat3 rx = mat3(1.0, 0.0, 0.0, 0.0, cos(ax), -sin(ax), 0.0, sin(ax), cos(ax));
      mat3 ry = mat3(cos(ay), 0.0, sin(ay), 0.0, 1.0, 0.0, -sin(ay), 0.0, cos(ay));
      mat3 rz = mat3(cos(az), -sin(az), 0.0, sin(az), cos(az), 0.0, 0.0, 0.0, 1.0);
      return rz * ry * rx * pos;
    }

    // Breathe - coherent expansion while preserving the subject
    if (animationType == 14) {
      float pulse = sin(animationPhase) * breatheAmount * animationIntensity;
      return pos * (1.0 + pulse);
    }

    // Drift - coherent three-dimensional noise motion
    if (animationType == 15) {
      vec3 samplePos = origPos * 0.7;
      vec3 drift = vec3(
        snoise(samplePos + vec3(animationPhase * 0.10, 17.0, 0.0)),
        snoise(samplePos + vec3(0.0, animationPhase * 0.08, 41.0)),
        snoise(samplePos + vec3(73.0, 0.0, animationPhase * 0.09))
      );
      return pos + drift * driftAmount * animationIntensity;
    }

    // Vortex - continuous height-dependent torsion
    if (animationType == 16) {
      float angle = animationPhase * 0.3 + origPos.y * vortexTwist * animationIntensity;
      float c = cos(angle);
      float s = sin(angle);
      return vec3(c * pos.x + s * pos.z, pos.y, -s * pos.x + c * pos.z);
    }

    return pos;
  }

  // Apply displacement effect
  vec3 applyDisplacement(vec3 pos) {
    if (displacementType == 0) return pos;

    // Noise displacement
    if (displacementType == 1) {
      vec3 noiseDir = vec3(
        snoise(pos * displacementScale + vec3(100.0, 0.0, 0.0) + time * displacementSpeed),
        snoise(pos * displacementScale + vec3(0.0, 100.0, 0.0) + time * displacementSpeed),
        snoise(pos * displacementScale + vec3(0.0, 0.0, 100.0) + time * displacementSpeed)
      );
      return pos + noiseDir * displacementAmount;
    }

    // Audio reactive displacement with a spatial envelope
    if (displacementType == 2 && audioEnabled) {
      vec3 dir = normalize(pos + vec3(0.0001));
      float envelope = audioLevel + beatIntensity * 0.65;
      float spatial = 0.65 + 0.35 * sin(
        length(pos) * max(displacementScale, 0.1) * 3.0 - time * displacementSpeed * 4.0
      );
      float audioDisp = envelope * audioDisplacement * displacementAmount * spatial;
      return pos + dir * audioDisp;
    }

    // Wave displacement
    if (displacementType == 3) {
      float wave = sin(pos.x * displacementScale + time * displacementSpeed * 2.0);
      wave += sin(pos.z * displacementScale + time * displacementSpeed * 1.5);
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
      float wind = snoise(pos * displacementScale + windDirection * time * displacementSpeed);
      return pos + windDirection * wind * displacementAmount;
    }

    // Magnetic field - attract toward the live interaction point, or origin
    if (displacementType == 6) {
      vec3 target = mouseInfluence > 0.0 ? mousePosition : vec3(0.0);
      vec3 delta = target - pos;
      float dist = max(length(delta), 0.05);
      float field = 1.0 / (1.0 + dist * dist * max(displacementScale, 0.1));
      return pos + normalize(delta) * field * displacementAmount;
    }

    // Ripple displacement
    if (displacementType == 7) {
      float dist = length(pos - mousePosition);
      float ripple = sin(dist * displacementScale * 5.0 - time * displacementSpeed * 5.0);
      ripple *= exp(-dist * max(displacementScale, 0.1) * 0.5);
      return pos + normalize(pos - mousePosition + vec3(0.0001)) * ripple * displacementAmount;
    }

    // Curl-like vector field - organic advection without changing topology
    if (displacementType == 8) {
      vec3 p = pos * displacementScale;
      float phase = time * displacementSpeed;
      vec3 flow = vec3(
        snoise(p + vec3(phase, 31.7, 12.1)),
        snoise(p + vec3(47.3, phase * 0.83, 5.9)),
        snoise(p + vec3(8.2, 19.4, phase * 1.13))
      );
      flow = normalize(flow + vec3(0.0001));
      return pos + flow * displacementAmount;
    }

    // Twist - axis-based torsion
    if (displacementType == 9) {
      float angle = (pos.y * displacementScale + time * displacementSpeed) * displacementAmount;
      float c = cos(angle);
      float s = sin(angle);
      return vec3(c * pos.x + s * pos.z, pos.y, -s * pos.x + c * pos.z);
    }

    // Radial pulse - expanding pressure rings through the cloud
    if (displacementType == 10) {
      float radius = length(pos);
      float pulse = sin(radius * displacementScale * 4.0 - time * displacementSpeed * 5.0);
      return pos + normalize(pos + vec3(0.0001)) * pulse * displacementAmount;
    }

    // Scanline - traveling planar field for scan/reconstruction looks
    if (displacementType == 11) {
      float plane = sin((pos.y + time * displacementSpeed) * displacementScale * 4.0);
      float gate = smoothstep(0.65, 1.0, plane);
      vec3 offset = vec3(
        snoise(pos * displacementScale + time * displacementSpeed),
        0.0,
        snoise(pos * displacementScale + time * displacementSpeed + 50.0)
      );
      return pos + offset * gate * displacementAmount;
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

    mat3 objectRotation = rotZ * rotY * rotX;
    pos = objectRotation * pos;
    pos += position3D;

    // Apply animation
    pos = applyAnimation(pos, objectRotation * originalPosition);

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
    vGaussianShape = gaussianShape;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    // Point size with optional attenuation + beat pulse
    float size = pointSize * gaussianScale;
    if (audioEnabled) {
      size *= 1.0 + audioLevel * audioScale * 0.5;
      // Beat pulse on point size
      size *= 1.0 + beatIntensity * audioScale * 0.3;
    }
    if (sizeAttenuation) {
      size *= 300.0 / max(-mvPosition.z, 0.001);
    }
    gl_PointSize = clamp(size, 0.0, maxPointSize);
  }
`;

// Fragment shader with color, opacity, render mode, and creative effects
export const fragmentShader = `
  uniform float time;
  uniform float opacity;
  uniform int renderMode;

  // Lighting and atmosphere
  uniform bool lightingEnabled;
  uniform float ambientIntensity;
  uniform vec3 keyLightColor;
  uniform float keyLightIntensity;
  uniform vec3 keyLightDirection;
  uniform vec3 rimLightColor;
  uniform float rimLightIntensity;
  uniform vec3 rimLightDirection;
  uniform float shadowStrength;
  uniform float shadowSoftness;
  uniform float specularStrength;
  uniform bool atmosphereEnabled;
  uniform float atmosphereDensity;
  uniform vec3 atmosphereColor;
  uniform float atmosphereScale;
  uniform float atmosphereTurbulence;
  uniform float atmosphereSpeed;

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
  uniform vec3 depthColorNear;
  uniform vec3 depthColorFar;
  uniform float depthGradientBias;

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
  varying vec3 vGaussianShape;

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
      float depthRange = max(pointCloudMax.z - pointCloudMin.z, 0.0001);
      float depth = clamp((vPosition.z - pointCloudMin.z) / depthRange, 0.0, 1.0);
      float shapedDepth = smoothstep(0.0, max(depthGradientBias, 0.001), depth) * 0.5
        + smoothstep(max(depthGradientBias, 0.001), 1.0, depth) * 0.5;
      return mix(color, mix(depthColorNear, depthColorFar, shapedDepth), intensity);
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
    float normalZ = sqrt(max(0.0, 1.0 - min(dot(coord * 2.0, coord * 2.0), 1.0)));
    vec3 pointNormal = normalize(vec3(coord * 2.0, normalZ));

    // Render mode shapes
    // 0: points (circle), 1: gaussians (soft), 2: spheres (3D), 3: billboards (square), 4: cubes (diamond)

    if (renderMode == 0) {
      // Points - hard circle
      if (dist > 0.5) discard;
      edgeAlpha = 1.0 - smoothstep(0.4, 0.5, dist);
    }
    else if (renderMode == 1) {
      // Anisotropic gaussian footprint from the imported splat scale and rotation.
      vec2 rotated = vec2(
        coord.x * vGaussianShape.y + coord.y * vGaussianShape.z,
        -coord.x * vGaussianShape.z + coord.y * vGaussianShape.y
      );
      rotated.y /= max(vGaussianShape.x, 0.08);
      float gaussian = exp(-dot(rotated, rotated) * 10.0);
      if (gaussian < 0.01) discard;
      edgeAlpha = gaussian;
    }
    else if (renderMode == 2) {
      // Spheres - 3D shaded look
      if (dist > 0.5) discard;
      float diffuse = max(0.0, dot(pointNormal, normalize(vec3(0.5, 0.5, 1.0))));
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

    if (lightingEnabled) {
      float keyDiffuse = max(0.0, dot(pointNormal, normalize(keyLightDirection)));
      float rim = pow(1.0 - max(pointNormal.z, 0.0), mix(5.0, 1.25, shadowSoftness));
      rim *= max(0.0, dot(pointNormal, normalize(rimLightDirection)) * 0.5 + 0.5);
      vec3 halfVector = normalize(normalize(keyLightDirection) + vec3(0.0, 0.0, 1.0));
      float specular = pow(max(0.0, dot(pointNormal, halfVector)), mix(48.0, 6.0, shadowSoftness));
      float heightShadow = smoothstep(-1.5, 1.5, vPosition.y);
      float shadow = mix(1.0 - shadowStrength, 1.0, mix(heightShadow, 1.0, shadowSoftness));
      vec3 lit = color * max(ambientIntensity, 0.0);
      lit += color * keyLightColor * keyDiffuse * keyLightIntensity * shadow;
      lit += rimLightColor * rim * rimLightIntensity;
      lit += keyLightColor * specular * specularStrength;
      color = lit;
    }

    float atmosphereMix = 0.0;
    if (atmosphereEnabled && atmosphereDensity > 0.0) {
      vec2 fogUV = vPosition.xz * max(atmosphereScale, 0.01);
      float fogNoise = noise2D(
        fogUV
        + vec2(time * atmosphereSpeed, -time * atmosphereSpeed * 0.63)
        + noise2D(fogUV * 0.47) * atmosphereTurbulence
      );
      float depthFog = smoothstep(-3.0, 5.0, -vPosition.z);
      atmosphereMix = clamp(
        atmosphereDensity * (0.25 + fogNoise * 0.75) * (0.55 + depthFog * 0.45),
        0.0,
        0.95
      );
      color = mix(color, atmosphereColor, atmosphereMix);
    }

    // Calculate alpha
    float alpha = vAlpha * opacity * edgeAlpha;
    alpha *= 1.0 - atmosphereMix * 0.12;

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
  private baselineMaterial: THREE.ShaderMaterial | null = null;
  private advancedMaterial: THREE.ShaderMaterial | null = null;
  private uniforms: Record<string, THREE.IUniform> | null = null;
  private startTime: number = 0;
  private plyData: PLYData | null = null;
  private geometryGeneration = 0;
  private smoothedAudioLevel = 0;
  private backgroundOpacity = 0;
  private backgroundColor = new THREE.Color(0x000000);

  // Wireframe rendering
  private wireframe: THREE.LineSegments | null = null;
  private wireframeGeometry: THREE.BufferGeometry | null = null;
  private wireframeMaterial: THREE.LineBasicMaterial | null = null;
  private currentRenderMode: string = 'points';
  private wireframeBuildPending = false;

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
  async loadData(data: PLYData, onProgress?: (progress: number, detail: string) => void): Promise<void> {
    const generation = ++this.geometryGeneration;

    // Normalize every import into the same working volume. Architectural scans,
    // face captures, and compact splats otherwise arrive several orders apart.
    const bb = data.boundingBox;
    const normalization = computeSplatNormalization(data);
    this.pointCloudBounds.min.set(
      (bb.min.x - normalization.center.x) * normalization.scale,
      (bb.min.y - normalization.center.y) * normalization.scale,
      (bb.min.z - normalization.center.z) * normalization.scale,
    );
    this.pointCloudBounds.max.set(
      (bb.max.x - normalization.center.x) * normalization.scale,
      (bb.max.y - normalization.center.y) * normalization.scale,
      (bb.max.z - normalization.center.z) * normalization.scale,
    );
    this.pointCloudBounds.size = 4;

    const loaded = await this.createGeometry(data, generation, onProgress);
    if (loaded) this.plyData = data;
  }

  // Get the currently loaded PLY data
  getData(): PLYData | null {
    return this.plyData;
  }

  private async createGeometry(
    data: PLYData,
    generation: number,
    onProgress?: (progress: number, detail: string) => void,
  ): Promise<boolean> {
    const vertices = data.vertices;
    const count = vertices.length;
    if (count === 0) throw new Error('Point cloud contains no renderable points');

    // Build replacement buffers off to the side so an existing cloud remains
    // renderable until the new upload is complete.
    const geometry = new THREE.BufferGeometry();

    // Position attribute
    const positions = new Float32Array(count * 3);
    const originalPositions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const alphas = new Float32Array(count);
    const indices = new Float32Array(count);
    const velocities = new Float32Array(count * 3);
    const uvs = new Float32Array(count * 2);
    const gaussianScales = new Float32Array(count);
    const gaussianShapes = new Float32Array(count * 3);
    const normalization = computeSplatNormalization(data);
    // A bounded sample is sufficient for footprint normalization. Sorting one
    // value for every point doubled peak memory on architectural captures.
    const scaleSampleCount = Math.min(count, 50_000);
    const scaleMagnitudes = new Float32Array(scaleSampleCount);
    for (let i = 0; i < scaleSampleCount; i++) {
      const sourceIndex = Math.min(count - 1, Math.floor((i * count) / scaleSampleCount));
      const decoded = normalizedGaussianScale(vertices[sourceIndex], normalization, data.scaleEncoding === 'linear');
      scaleMagnitudes[i] = Math.max(decoded[0], decoded[1], decoded[2]);
    }
    const sortedScales = Array.from(scaleMagnitudes)
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    const medianScale =
      sortedScales.length > 0 ? Math.max(sortedScales[Math.floor(sortedScales.length / 2)], 0.0001) : 1;

    onProgress?.(0.08, `Preparing ${count.toLocaleString()} points`);
    for (let i = 0; i < count; i++) {
      const v = vertices[i];
      const i3 = i * 3;

      const normalizedPosition = normalizedSplatPosition(v, normalization);
      positions[i3] = normalizedPosition[0];
      positions[i3 + 1] = normalizedPosition[1];
      positions[i3 + 2] = normalizedPosition[2];

      // Store original positions
      originalPositions[i3] = positions[i3];
      originalPositions[i3 + 1] = positions[i3 + 1];
      originalPositions[i3 + 2] = positions[i3 + 2];

      // Colors (normalized)
      colors[i3] = v.r / 255;
      colors[i3 + 1] = v.g / 255;
      colors[i3 + 2] = v.b / 255;

      // Alpha
      alphas[i] = v.a / 255;

      // Vertex index for effects
      indices[i] = i;

      // Initialize velocities
      velocities[i3] = 0;
      velocities[i3 + 1] = 0;
      velocities[i3 + 2] = 0;

      // UV coordinates from file (if available)
      const i2 = i * 2;
      uvs[i2] = v.texture_u ?? 0;
      uvs[i2 + 1] = v.texture_v ?? 0;

      const scales = normalizedGaussianScale(v, normalization, data.scaleEncoding === 'linear');
      const major = Math.max(scales[0], scales[1], scales[2], 0.0001);
      const minor = Math.max(Math.min(scales[0], scales[1], scales[2]), major * 0.08);
      gaussianScales[i] = data.dataType === 'gaussian' ? Math.max(0.35, Math.min(4, major / medianScale)) : 1;

      const qw = v.rot_0 ?? 1;
      const qx = v.rot_1 ?? 0;
      const qy = v.rot_2 ?? 0;
      const qz = v.rot_3 ?? 0;
      const angle = Math.atan2(2 * (qw * qz + qx * qy), 1 - 2 * (qy * qy + qz * qz));
      gaussianShapes[i3] = data.dataType === 'gaussian' ? minor / major : 1;
      gaussianShapes[i3 + 1] = Math.cos(angle);
      gaussianShapes[i3 + 2] = Math.sin(angle);

      if ((i + 1) % 25_000 === 0) {
        onProgress?.(
          0.08 + 0.72 * ((i + 1) / count),
          `Preparing point ${Math.min(i + 1, count).toLocaleString()} of ${count.toLocaleString()}`,
        );
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (generation !== this.geometryGeneration) {
          geometry.dispose();
          return false;
        }
      }
    }

    onProgress?.(0.84, 'Creating GPU buffers');
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('originalPosition', new THREE.BufferAttribute(originalPositions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1));
    geometry.setAttribute('vertexIndex', new THREE.BufferAttribute(indices, 1));
    geometry.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));
    geometry.setAttribute('texUV', new THREE.BufferAttribute(uvs, 2));
    geometry.setAttribute('gaussianScale', new THREE.BufferAttribute(gaussianScales, 1));
    geometry.setAttribute('gaussianShape', new THREE.BufferAttribute(gaussianShapes, 3));

    // Start every import on the compact baseline program. The advanced shader
    // is compiled lazily only when the layer actually enables an advanced
    // feature, avoiding a multi-million-point GPU timeout during normal load.
    const uniforms = this.createUniforms();
    const material = this.createBaselineMaterial(uniforms);

    // Create points
    const points = new THREE.Points(geometry, material);
    if (generation !== this.geometryGeneration) {
      geometry.dispose();
      material.dispose();
      return false;
    }

    const oldGeometry = this.geometry;
    const oldBaselineMaterial = this.baselineMaterial;
    const oldAdvancedMaterial = this.advancedMaterial;
    const oldPoints = this.points;
    if (oldPoints) this.scene.remove(oldPoints);
    this.geometry = geometry;
    this.uniforms = uniforms;
    this.baselineMaterial = material;
    this.advancedMaterial = null;
    this.material = material;
    this.points = points;
    this.originalPositions = originalPositions;
    this.velocities = velocities;
    this.scene.add(points);
    oldGeometry?.dispose();
    oldBaselineMaterial?.dispose();
    oldAdvancedMaterial?.dispose();

    this.disposeWireframe();
    this.wireframeBuildPending = false;
    onProgress?.(1, 'GPU buffers ready');
    return true;
  }

  private createBaselineMaterial(uniforms: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      vertexShader: baselineVertexShader,
      fragmentShader: baselineFragmentShader,
      uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
  }

  private createAdvancedMaterial(uniforms: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
  }

  private selectMaterial(content: SplatContent): void {
    if (!this.points || !this.uniforms || !this.baselineMaterial) return;

    let nextMaterial = this.baselineMaterial;
    if (requiresAdvancedSplatMaterial(content)) {
      this.advancedMaterial ??= this.createAdvancedMaterial(this.uniforms);
      nextMaterial = this.advancedMaterial;
    }

    if (this.material !== nextMaterial) {
      this.material = nextMaterial;
      this.points.material = nextMaterial;
    }
  }

  // Create wireframe geometry connecting nearby points
  private disposeWireframe(): void {
    if (this.wireframeGeometry) {
      this.wireframeGeometry.dispose();
    }
    if (this.wireframeMaterial) {
      this.wireframeMaterial.dispose();
    }
    if (this.wireframe) {
      this.scene.remove(this.wireframe);
    }
    this.wireframe = null;
    this.wireframeGeometry = null;
    this.wireframeMaterial = null;
  }

  private async createWireframeGeometry(
    data: PLYData,
    sourcePositions: Float32Array,
    sourceColors: Float32Array,
    generation: number,
  ): Promise<void> {
    this.disposeWireframe();

    // Wireframe is an alternate visualization, not a reason to allocate
    // millions of neighbor records during every import.
    const count = Math.min(data.vertices.length, 75_000);
    if (count < 2) return;
    const positions = count === data.vertices.length ? sourcePositions : new Float32Array(count * 3);
    const colors = count === data.vertices.length ? sourceColors : new Float32Array(count * 3);
    if (count !== data.vertices.length) {
      for (let i = 0; i < count; i++) {
        const sourceIndex = Math.min(data.vertices.length - 1, Math.floor((i * data.vertices.length) / count));
        positions.set(sourcePositions.subarray(sourceIndex * 3, sourceIndex * 3 + 3), i * 3);
        colors.set(sourceColors.subarray(sourceIndex * 3, sourceIndex * 3 + 3), i * 3);
      }
    }

    // Positions are normalized before this pass, so neighborhood distance must
    // use the normalized working volume too. Using source units made large
    // architectural scans connect every point and tiny captures connect none.
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
      if ((i + 1) % 10_000 === 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (generation !== this.geometryGeneration || data !== this.plyData) return;
      }
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
      if ((i + 1) % 5_000 === 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (generation !== this.geometryGeneration || data !== this.plyData) return;
      }
    }

    if (lineIndices.length === 0) return;
    if (generation !== this.geometryGeneration || data !== this.plyData) return;

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
      maxPointSize: { value: 48 },
      sizeAttenuation: { value: true },
      opacity: { value: 1 },
      renderMode: { value: 0 },

      // Animation
      animationProgress: { value: 0 },
      animationPhase: { value: 0 },
      animationIntensity: { value: 1 },
      animationType: { value: 0 },
      explodeForce: { value: 1 },
      explodeTurbulence: { value: 0.35 },
      implodeForce: { value: 0.85 },
      implodeSpin: { value: 1.5 },
      voxelGridSize: { value: 16 },
      peelAxis: { value: new THREE.Vector3(0, 1, 0) },
      peelDirection: { value: 1 },
      peelWidth: { value: 0.55 },
      peelCurl: { value: 2.2 },
      sliceWidth: { value: 3 },
      sliceSoftness: { value: 0.2 },
      sliceTravel: { value: 1 },
      waveAxis: { value: new THREE.Vector3(0, 1, 0) },
      animationWaveFrequency: { value: 5 },
      animationWaveAmplitude: { value: 0.3 },
      scatterDistance: { value: 2 },
      scatterRandomness: { value: 8 },
      spiralRadius: { value: 0.75 },
      spiralTurns: { value: 2 },
      spiralLift: { value: 1 },
      swarmCohesion: { value: 0.3 },
      swarmSeparation: { value: 0.4 },
      swarmAlignment: { value: 0.6 },
      gravityStrength: { value: 2 },
      gravitySpread: { value: 0.25 },
      gravityFloor: { value: -2 },
      turntableTilt: { value: 0 },
      tumbleSpread: { value: 1 },
      breatheAmount: { value: 0.15 },
      driftAmount: { value: 0.25 },
      vortexTwist: { value: 2 },
      morphRoundness: { value: 1 },
      gravity: { value: 9.8 },
      turbulence: { value: 0 },

      // Displacement
      displacementType: { value: 0 },
      displacementAmount: { value: 0.5 },
      displacementScale: { value: 2 },
      displacementSpeed: { value: 1 },
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

      // Lighting and atmosphere
      lightingEnabled: { value: true },
      ambientIntensity: { value: 1 },
      keyLightColor: { value: new THREE.Vector3(1, 1, 1) },
      keyLightIntensity: { value: 1 },
      keyLightDirection: { value: new THREE.Vector3(0.5, 0.5, 1).normalize() },
      rimLightColor: { value: new THREE.Vector3(0.2, 0.67, 1) },
      rimLightIntensity: { value: 0.35 },
      rimLightDirection: { value: new THREE.Vector3(-0.5, 0.25, 1).normalize() },
      shadowStrength: { value: 0.45 },
      shadowSoftness: { value: 0.5 },
      specularStrength: { value: 0.3 },
      atmosphereEnabled: { value: false },
      atmosphereDensity: { value: 0.2 },
      atmosphereColor: { value: new THREE.Vector3(0.08, 0.12, 0.16) },
      atmosphereScale: { value: 1.5 },
      atmosphereTurbulence: { value: 0.7 },
      atmosphereSpeed: { value: 0.15 },

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
      depthColorNear: { value: new THREE.Vector3(1, 0.36, 0.2) },
      depthColorFar: { value: new THREE.Vector3(0.2, 0.47, 1) },
      depthGradientBias: { value: 0.5 },
      hologramSpeed: { value: 2 },
      hologramDensity: { value: 20 },

      // Opacity effects
      opacityEffectType: { value: 0 },
      opacityEffectIntensity: { value: 1 },
      dofFocalDistance: { value: 0.5 },
      dofBlurAmount: { value: 0.5 },
      fogDensity: { value: 0.3 },
      fogColor: { value: new THREE.Vector3(0.2, 0.2, 0.31) },
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
      if (this.uniforms) {
        this.uniforms.textureEnabled.value = false;
        this.uniforms.textureMap.value = null;
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

        if (this.uniforms) {
          this.uniforms.textureMap.value = videoTexture;
        }

        video.play().catch((e) => console.warn('Video autoplay blocked:', e));
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

          if (this.uniforms) {
            this.uniforms.textureMap.value = texture;
          }
        },
        undefined,
        (err) => console.error('Failed to load texture:', err),
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
    if (!this.uniforms) return;
    this.selectMaterial(content);
    if (!this.material) return;

    const time = (performance.now() - this.startTime) / 1000;
    const u = this.uniforms;

    // Time
    u.time.value = time;

    // Point rendering
    u.pointSize.value = content.pointSize;
    const geometryPointCount = this.geometry?.getAttribute('position')?.count ?? 0;
    const activePointCount = Math.max(
      1,
      Math.floor(geometryPointCount * Math.max(0.01, Math.min(1, content.pointDensity ?? 1))),
    );
    u.maxPointSize.value =
      activePointCount >= 1_000_000
        ? 6
        : activePointCount >= 500_000
          ? 8
          : activePointCount >= 250_000
            ? 12
            : activePointCount >= 100_000
              ? 18
              : 48;
    u.sizeAttenuation.value = content.pointSizeAttenuation;
    u.opacity.value = content.opacity;
    u.renderMode.value = this.getRenderModeIndex(content.renderMode);

    // Toggle between points and wireframe based on render mode
    const isWireframe = content.renderMode === 'wireframe';
    if (isWireframe && !this.wireframe && !this.wireframeBuildPending && this.geometry && this.plyData) {
      const positions = this.geometry.getAttribute('position').array as Float32Array;
      const colors = this.geometry.getAttribute('color').array as Float32Array;
      const generation = this.geometryGeneration;
      this.wireframeBuildPending = true;
      void this.createWireframeGeometry(this.plyData, positions, colors, generation)
        .then(() => {
          if (this.wireframe) this.wireframe.visible = this.currentRenderMode === 'wireframe';
        })
        .catch((error) => {
          console.error('[SplatRenderer] Failed to build wireframe:', error);
        })
        .finally(() => {
          this.wireframeBuildPending = false;
        });
    }
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
    const animationClock = resolveSplatAnimationClock({
      time,
      speed: content.animationSpeed,
      loop: content.animationLoop,
      pingPong: content.animationPingPong ?? false,
      manualProgress: content.animationProgress,
    });
    u.animationProgress.value = animationClock.progress;
    u.animationPhase.value = animationClock.phase;
    u.animationIntensity.value = content.animationIntensity;
    u.explodeForce.value = content.explodeForce;
    u.explodeTurbulence.value = content.explodeTurbulence ?? 0.35;
    u.implodeForce.value = content.implodeForce ?? 0.85;
    u.implodeSpin.value = content.implodeSpin ?? 1.5;
    u.voxelGridSize.value = content.voxelGridSize;
    u.peelDirection.value = content.peelDirection ?? 1;
    u.peelWidth.value = content.peelWidth ?? 0.55;
    u.peelCurl.value = content.peelCurl ?? 2.2;
    u.sliceWidth.value = content.sliceWidth ?? 3;
    u.sliceSoftness.value = content.sliceSoftness ?? 0.2;
    u.sliceTravel.value = content.sliceTravel ?? 1;
    u.peelAxis.value.set(
      content.peelAxis === 'x' ? 1 : 0,
      content.peelAxis === 'y' ? 1 : 0,
      content.peelAxis === 'z' ? 1 : 0,
    );
    const waveAxis = content.waveAxis ?? 'y';
    u.waveAxis.value.set(waveAxis === 'x' ? 1 : 0, waveAxis === 'y' ? 1 : 0, waveAxis === 'z' ? 1 : 0);
    u.animationWaveFrequency.value = content.animationWaveFrequency ?? 5;
    u.animationWaveAmplitude.value = content.animationWaveAmplitude ?? 0.3;
    u.scatterDistance.value = content.scatterDistance ?? 2;
    u.scatterRandomness.value = content.scatterRandomness ?? 8;
    u.spiralRadius.value = content.spiralRadius ?? 0.75;
    u.spiralTurns.value = content.spiralTurns ?? 2;
    u.spiralLift.value = content.spiralLift ?? 1;
    u.swarmCohesion.value = content.swarmCohesion ?? 0.3;
    u.swarmSeparation.value = content.swarmSeparation ?? 0.4;
    u.swarmAlignment.value = content.swarmAlignment ?? 0.6;
    u.gravityStrength.value = content.gravityStrength ?? 2;
    u.gravitySpread.value = content.gravitySpread ?? 0.25;
    u.gravityFloor.value = content.gravityFloor ?? -2;
    u.turntableTilt.value = ((content.turntableTilt ?? 0) * Math.PI) / 180;
    u.tumbleSpread.value = content.tumbleSpread ?? 1;
    u.breatheAmount.value = content.breatheAmount ?? 0.15;
    u.driftAmount.value = content.driftAmount ?? 0.25;
    u.vortexTwist.value = content.vortexTwist ?? 2;
    u.morphRoundness.value = content.morphRoundness ?? 1;
    u.gravity.value = content.physics.gravity;
    u.turbulence.value = content.physics.turbulence;

    // Displacement
    u.displacementType.value = this.getDisplacementTypeIndex(content.displacementType);
    u.displacementAmount.value = content.displacementAmount ?? content.displacementIntensity ?? 0.5;
    u.displacementScale.value = content.displacementScale ?? content.noiseScale ?? 2;
    u.displacementSpeed.value = content.displacementSpeed ?? content.noiseSpeed ?? 1;
    u.noiseScale.value = content.noiseScale ?? content.displacementScale ?? 2;
    u.noiseSpeed.value = content.noiseSpeed ?? content.displacementSpeed ?? 1;
    u.waveFrequency.value = content.waveFrequency;
    u.waveAmplitude.value = content.waveAmplitude;
    u.glitchIntensity.value = content.glitchIntensity;
    u.windDirection.value.set(content.windDirection.x, content.windDirection.y, content.windDirection.z);
    u.windStrength.value = content.windStrength;

    // Audio
    u.audioEnabled.value = content.audioEnabled;
    this.smoothedAudioLevel = smoothSplatAudio(
      this.smoothedAudioLevel,
      content.audioEnabled ? audioLevel : 0,
      content.audioSmoothing ?? 0.7,
    );
    u.audioLevel.value = this.smoothedAudioLevel;
    u.audioDisplacement.value = content.audioDisplacement;
    u.audioScale.value = content.audioScale;
    u.audioColor.value = content.audioColor;
    // Beat reactivity from full audio state
    u.beatIntensity.value =
      typeof audioState?.beat === 'number' ? audioState.beat : audioState?.beat?.beatIntensity || 0;
    u.beatPhase.value = audioState?.beatPhase || 0;

    // Lighting and atmosphere
    u.lightingEnabled.value = content.lightingEnabled ?? true;
    u.ambientIntensity.value = content.ambientIntensity ?? 1;
    const keyColor = hexToRgb01(content.keyLightColor, '#ffffff');
    u.keyLightColor.value.set(keyColor[0], keyColor[1], keyColor[2]);
    u.keyLightIntensity.value = content.keyLightIntensity ?? 1;
    const keyAzimuth = ((content.keyLightAzimuth ?? 35) * Math.PI) / 180;
    const keyElevation = ((content.keyLightElevation ?? 40) * Math.PI) / 180;
    u.keyLightDirection.value
      .set(
        Math.cos(keyElevation) * Math.sin(keyAzimuth),
        Math.sin(keyElevation),
        Math.cos(keyElevation) * Math.cos(keyAzimuth),
      )
      .normalize();
    const rimColor = hexToRgb01(content.rimLightColor, '#33aaff');
    u.rimLightColor.value.set(rimColor[0], rimColor[1], rimColor[2]);
    u.rimLightIntensity.value = content.rimLightIntensity ?? 0.35;
    const rimAzimuth = ((content.rimLightAzimuth ?? -45) * Math.PI) / 180;
    u.rimLightDirection.value.set(Math.sin(rimAzimuth), 0.35, Math.cos(rimAzimuth)).normalize();
    u.shadowStrength.value = content.shadowStrength ?? 0.45;
    u.shadowSoftness.value = content.shadowSoftness ?? 0.5;
    u.specularStrength.value = content.specularStrength ?? 0.3;

    u.atmosphereEnabled.value = content.atmosphereEnabled ?? false;
    u.atmosphereDensity.value = content.atmosphereDensity ?? 0.2;
    const atmosphereColor = hexToRgb01(content.atmosphereColor, '#14202b');
    u.atmosphereColor.value.set(atmosphereColor[0], atmosphereColor[1], atmosphereColor[2]);
    u.atmosphereScale.value = content.atmosphereScale ?? 1.5;
    u.atmosphereTurbulence.value = content.atmosphereTurbulence ?? 0.7;
    u.atmosphereSpeed.value = content.atmosphereSpeed ?? 0.15;
    this.backgroundOpacity = content.backgroundOpacity ?? 0;
    this.backgroundColor.set(content.backgroundColor ?? '#000000');
    if (this.renderer) {
      this.renderer.setClearColor(this.backgroundColor, this.backgroundOpacity);
    }

    // Transform
    u.scaleUniform.value = content.scaleUniform;
    const autoRotation = content.autoRotate ? (time * content.autoRotateSpeed * Math.PI) / 180 : 0;
    const [rotationX, rotationY, rotationZ] = composeSplatRotationRadians(content, autoRotation);
    u.rotation3D.value.set(rotationX, rotationY, rotationZ);
    u.position3D.value.set(content.positionX, content.positionY, content.positionZ);

    // Slice plane
    u.sliceEnabled.value = content.slicePlane.enabled;
    u.sliceAxis.value.set(
      content.slicePlane.axis === 'x' ? 1 : 0,
      content.slicePlane.axis === 'y' ? 1 : 0,
      content.slicePlane.axis === 'z' ? 1 : 0,
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
    const depthNear = hexToRgb01(content.depthColorNear, '#ff5c33');
    const depthFar = hexToRgb01(content.depthColorFar, '#3377ff');
    u.depthColorNear.value.set(depthNear[0], depthNear[1], depthNear[2]);
    u.depthColorFar.value.set(depthFar[0], depthFar[1], depthFar[2]);
    u.depthGradientBias.value = content.depthGradientBias ?? 0.5;
    u.hologramSpeed.value = content.hologramSpeed;
    u.hologramDensity.value = content.hologramDensity;

    // Opacity effects
    u.opacityEffectType.value = this.getOpacityEffectIndex(content.opacityEffectType);
    u.opacityEffectIntensity.value = content.opacityEffectIntensity;
    u.dofFocalDistance.value = content.dofFocalDistance;
    u.dofBlurAmount.value = content.dofBlurAmount;
    u.fogDensity.value = content.fogDensity;
    const fogColor = hexToRgb01(content.fogColor, '#323250');
    u.fogColor.value.set(fogColor[0], fogColor[1], fogColor[2]);
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
    if (this.material) {
      this.material.depthTest = content.depthTest;
    }
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
    const distance = resolveSplatCameraDistance(content.cameraDistance);
    const orbitX = (Math.max(-89, Math.min(89, content.cameraOrbitX)) * Math.PI) / 180;
    const orbitY = (content.cameraOrbitY * Math.PI) / 180;
    const roll = ((content.cameraRoll ?? 0) * Math.PI) / 180;

    // Calculate camera position from orbit angles (looking at origin)
    const camX = Math.sin(orbitY) * Math.cos(orbitX) * distance;
    const camY = Math.sin(orbitX) * distance;
    const camZ = Math.cos(orbitY) * Math.cos(orbitX) * distance;

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
        width,
        height,
        -panX * width, // negative because we want right = positive X on screen
        panY * height, // positive because we want up = positive Y on screen
        width,
        height,
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
      'none',
      'explode',
      'implode',
      'slice',
      'voxelSnap',
      'peel',
      'gravity',
      'swarm',
      'morph',
      'orbit',
      'wave3d',
      'scatter',
      'spiral',
      'tumble',
      'breathe',
      'drift',
      'vortex',
    ];
    return types.indexOf(type);
  }

  private getDisplacementTypeIndex(type: SplatDisplacementType): number {
    const types: SplatDisplacementType[] = [
      'none',
      'noise',
      'audioReactive',
      'wave',
      'glitch',
      'wind',
      'magnetic',
      'ripple',
      'curlNoise',
      'twist',
      'radialPulse',
      'scanline',
    ];
    return types.indexOf(type);
  }

  private getRenderModeIndex(mode: string): number {
    const modes = ['points', 'gaussians', 'spheres', 'billboards', 'cubes'];
    return Math.max(0, modes.indexOf(mode));
  }

  private getColorEffectIndex(type: SplatColorEffectType): number {
    const types: SplatColorEffectType[] = [
      'none',
      'chromatic',
      'heatmap',
      'pointillist',
      'hologram',
      'rainbow',
      'audioColor',
      'depthGradient',
      'neon',
      'pastel',
      'cyberpunk',
      'fire',
      'ice',
    ];
    const idx = types.indexOf(type);
    return idx >= 0 ? idx : 0;
  }

  private getOpacityEffectIndex(type: SplatOpacityEffectType): number {
    const types: SplatOpacityEffectType[] = [
      'none',
      'dof',
      'fog',
      'pulse',
      'proximity',
      'dissolve',
      'scanReveal',
      'audioFade',
    ];
    return types.indexOf(type);
  }

  private getCreativeEffectIndex(type: SplatCreativeEffectType): number {
    const types: SplatCreativeEffectType[] = [
      'none',
      'feedback',
      'kaleidoscope',
      'constellation',
      'datamosh',
      'pixelSort',
      'echo',
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
    externalRenderer.setClearColor(this.backgroundColor, this.backgroundOpacity);
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
    this.geometryGeneration++;
    if (this.geometry) this.geometry.dispose();
    this.baselineMaterial?.dispose();
    this.advancedMaterial?.dispose();
    this.material = null;
    this.baselineMaterial = null;
    this.advancedMaterial = null;
    this.uniforms = null;
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
