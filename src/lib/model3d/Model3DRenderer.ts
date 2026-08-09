// Model3D Renderer - Three.js based 3D model renderer
// Implements vertex-based morphing, materials, deformations, animations, and VJ effects

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type {
  Model3DContent,
  Model3DMaterialType,
  Model3DDeformationType,
  Model3DAnimationType,
  Model3DEchoType,
  Model3DWireframeMode,
  Model3DVertexDecoration,
  Model3DLightingPreset,
} from '../types';

export type Model3DLightingProfile = {
  ambientScale: number;
  keyScale: number;
  fillScale: number;
  rimScale: number;
  environmentScale: number;
  azimuthOffset: number;
  elevationOffset: number;
  selfShadowStrength: number;
};

export function getModel3DLightingProfile(
  preset: Model3DLightingPreset,
): Model3DLightingProfile {
  switch (preset) {
    case 'dramatic':
      return {
        ambientScale: 0.25,
        keyScale: 1.65,
        fillScale: 0.3,
        rimScale: 1.25,
        environmentScale: 0.22,
        azimuthOffset: -55,
        elevationOffset: -18,
        selfShadowStrength: 0.85,
      };
    case 'neon':
      return {
        ambientScale: 0.38,
        keyScale: 1.15,
        fillScale: 0.65,
        rimScale: 1.9,
        environmentScale: 0.28,
        azimuthOffset: 35,
        elevationOffset: -10,
        selfShadowStrength: 0.65,
      };
    case 'sunrise':
      return {
        ambientScale: 0.52,
        keyScale: 1.35,
        fillScale: 0.55,
        rimScale: 0.55,
        environmentScale: 0.4,
        azimuthOffset: -85,
        elevationOffset: -34,
        selfShadowStrength: 0.68,
      };
    case 'moonlight':
      return {
        ambientScale: 0.28,
        keyScale: 0.85,
        fillScale: 0.35,
        rimScale: 1.5,
        environmentScale: 0.3,
        azimuthOffset: 110,
        elevationOffset: 10,
        selfShadowStrength: 0.78,
      };
    case 'disco':
      return {
        ambientScale: 0.4,
        keyScale: 1.1,
        fillScale: 0.7,
        rimScale: 1.35,
        environmentScale: 0.26,
        azimuthOffset: 20,
        elevationOffset: -8,
        selfShadowStrength: 0.58,
      };
    case 'none':
      return {
        ambientScale: 1,
        keyScale: 0,
        fillScale: 0,
        rimScale: 0,
        environmentScale: 0,
        azimuthOffset: 0,
        elevationOffset: 0,
        selfShadowStrength: 0,
      };
    case 'studio':
    default:
      return {
        ambientScale: 1,
        keyScale: 1,
        fillScale: 1,
        rimScale: 1,
        environmentScale: 0.7,
        azimuthOffset: 0,
        elevationOffset: 0,
        selfShadowStrength: 0.48,
      };
  }
}

// ============================================================================
// UNIFIED VERTEX SHADER WITH MORPHING
// ============================================================================

const morphingVertexShader = `
  #include <skinning_pars_vertex>

  attribute vec3 originalPosition;
  attribute vec3 originalNormal;

  varying vec3 vPosition;
  varying vec3 vNormal;
  varying vec3 vWorldPosition;
  varying vec2 vUv;
  varying float vMorphIntensity;

  uniform float time;
  uniform float morphIntensity;
  uniform int morphType;
  uniform float morphSpeed;
  uniform float morphScale;
  uniform float morphPhase;
  uniform vec3 morphCenter;
  uniform float morphReferenceSize;
  uniform float audioLevel;
  uniform float audioMorphResponse;
  // Spread = how far displacement-style morphs push pieces from their rest position.
  // 1.0 keeps legacy behavior; >1 pushes farther (explode/shatter/etc.).
  uniform float morphSpread;

  // Simplex noise for organic deformation
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
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
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
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
  }

  // Multi-octave noise for more organic feel
  float fbm(vec3 p) {
    float f = 0.0;
    f += 0.5000 * snoise(p); p *= 2.01;
    f += 0.2500 * snoise(p); p *= 2.02;
    f += 0.1250 * snoise(p); p *= 2.03;
    f += 0.0625 * snoise(p);
    return f / 0.9375;
  }

  vec3 applyMorph(vec3 pos, vec3 norm) {
    float intensity = morphIntensity + audioLevel * audioMorphResponse;
    if (morphType == 0 || intensity < 0.001) return pos;

    // Imported assets arrive in wildly different coordinate scales. Perform
    // deformation in the same canonical two-unit space used by the viewer,
    // then convert back to source coordinates before Three.js applies the
    // model's normalization transform.
    float assetToCanonical = 2.0 / max(morphReferenceSize, 0.0001);
    pos *= assetToCanonical;
    vec3 center = morphCenter * assetToCanonical;

    float t = time * morphSpeed + morphPhase;
    vec3 offset = vec3(0.0);
    float localIntensity = 0.0;

    // 1: Organic noise - like something breathing inside
    if (morphType == 1) {
      float noise1 = fbm(pos * morphScale + t * 0.5);
      float noise2 = fbm(pos * morphScale * 1.5 - t * 0.3);
      float combinedNoise = noise1 * 0.7 + noise2 * 0.3;
      offset = norm * combinedNoise * intensity * morphSpread;
      localIntensity = abs(combinedNoise);
    }

    // 2: Pulse from center - heartbeat ripple
    else if (morphType == 2) {
      vec3 toCenter = pos - center;
      float dist = length(toCenter);
      float pulse = sin(dist * morphScale * 3.0 - t * 4.0) * 0.5 + 0.5;
      pulse = pow(pulse, 2.0);
      offset = normalize(toCenter) * pulse * intensity * 0.5 * morphSpread;
      localIntensity = pulse;
    }

    // 3: Wave ripples - water-like surface
    else if (morphType == 3) {
      float wave1 = sin(pos.x * morphScale * 2.0 + t * 2.0);
      float wave2 = sin(pos.z * morphScale * 2.0 + t * 1.7);
      float wave3 = sin((pos.x + pos.z) * morphScale + t * 2.3);
      float combined = (wave1 + wave2 + wave3) / 3.0;
      offset = norm * combined * intensity * 0.5 * morphSpread;
      localIntensity = abs(combined);
    }

    // 4: Twist around Y axis - internal torque (spread amplifies twist angle)
    else if (morphType == 4) {
      float twist = sin(pos.y * morphScale + t) * intensity * 0.5 * morphSpread;
      float c = cos(twist);
      float s = sin(twist);
      vec3 twisted = vec3(pos.x * c - pos.z * s, pos.y, pos.x * s + pos.z * c);
      offset = twisted - pos;
      localIntensity = abs(twist);
    }

    // 5: Inflate/deflate - breathing
    else if (morphType == 5) {
      float breath = sin(t * 2.0) * 0.5 + 0.5;
      breath = pow(breath, 0.7);
      float variation = 1.0 + snoise(pos * morphScale * 2.0 + t * 0.5) * 0.2;
      offset = norm * breath * intensity * variation * morphSpread;
      localIntensity = breath;
    }

    // 6: Bulge traveling wave (climbs Y axis)
    else if (morphType == 6) {
      float wave = sin(pos.y * morphScale * 2.0 - t * 3.0);
      wave = max(0.0, wave);
      wave = pow(wave, 2.0);
      offset = norm * wave * intensity * morphSpread;
      localIntensity = wave;
    }

    // 7: Jelly wobble - soft body physics feel
    else if (morphType == 7) {
      float wobble1 = sin(pos.y * 3.0 + t * 4.0) * sin(pos.x * 2.0 + t * 3.0);
      float wobble2 = sin(pos.z * 2.5 + t * 3.5) * cos(pos.y * 2.0 + t * 2.5);
      float jelly = (wobble1 + wobble2) * 0.5;
      float lag = length(pos - center) * 0.5;
      jelly = sin(jelly * 3.14159 + lag);
      offset = norm * jelly * intensity * 0.4 * morphSpread;
      localIntensity = abs(jelly);
    }

    // 8: Explode outward — STEADY at full intensity (no time oscillation).
    // Pair with the Animation "Rotate" type for the classic "exploded view spin".
    else if (morphType == 8) {
      vec3 dir = normalize(pos - center);
      // Per-vertex noise so fragments fly at varied distances.
      float noise = snoise(pos * 10.0) * 0.3 + 0.7;
      offset = dir * intensity * noise * morphSpread;
      localIntensity = intensity;
    }

    // 9: Implode - steady inward pull (no time oscillation)
    else if (morphType == 9) {
      vec3 toCenter = center - pos;
      float noise = snoise(pos * 10.0) * 0.3 + 0.7;
      // Clamp so vertices can fully reach center but don't overshoot wildly.
      float pull = clamp(intensity * morphSpread, 0.0, 1.5);
      offset = toCenter * pull * noise * 0.5;
      localIntensity = intensity;
    }

    // 10: Melt - droop downward
    else if (morphType == 10) {
      float height = (pos.y - center.y + 1.0) * 0.5;
      float melt = pow(height, 2.0) * intensity * morphSpread;
      float noise = snoise(pos * morphScale + t * 0.2);
      offset.y = -melt * 0.5;
      offset.x = noise * melt * 0.3;
      offset.z = noise * melt * 0.3;
      localIntensity = melt;
    }

    // 11: Spherify - pull toward unit sphere (steady — easier to combine with rotate)
    else if (morphType == 11) {
      vec3 toCenter = pos - center;
      float dist = length(toCenter);
      vec3 spherePos = center + normalize(toCenter) * morphSpread; // Sphere radius scales with spread
      offset = (spherePos - pos) * intensity;
      localIntensity = intensity;
    }

    // 12: Taper - pinch ends toward axis (steady)
    else if (morphType == 12) {
      float y = pos.y - center.y;
      float pinch = abs(y) * intensity * morphSpread;
      vec3 horizontal = vec3(pos.x - center.x, 0.0, pos.z - center.z);
      offset = -normalize(horizontal) * pinch * length(horizontal);
      localIntensity = intensity;
    }

    // 13: Tentacle wave - organic tendrils
    else if (morphType == 13) {
      float wave = sin(pos.y * morphScale * 4.0 - t * 3.0 + pos.x * 2.0);
      float wave2 = sin(pos.y * morphScale * 4.0 - t * 3.0 + pos.z * 2.0 + 1.0);
      offset.x = wave * intensity * 0.3 * (pos.y - center.y + 1.0) * morphSpread;
      offset.z = wave2 * intensity * 0.3 * (pos.y - center.y + 1.0) * morphSpread;
      localIntensity = abs(wave);
    }

    // 14: Shatter — steady fragment displacement (each "fragment" is a noise-cluster)
    else if (morphType == 14) {
      // Quantize position into chunks so neighbors share a fragment offset.
      vec3 chunk = floor(pos * morphScale * 0.8) / (morphScale * 0.8);
      vec3 dir = normalize(pos - center + 0.001);
      // Per-chunk pseudo-random scatter direction
      float n1 = snoise(chunk * 5.0);
      float n2 = snoise(chunk * 5.0 + 100.0);
      float n3 = snoise(chunk * 5.0 + 200.0);
      vec3 scatter = normalize(vec3(n1, n2, n3) + dir * 0.5);
      offset = scatter * intensity * morphSpread * (0.6 + abs(n1) * 0.4);
      localIntensity = intensity;
    }

    // 15: Magnetic - pull toward poles
    else if (morphType == 15) {
      float pull = sin(t) * 0.5 + 0.5;
      offset.y = sign(pos.y - center.y) * pull * intensity * 0.5 * morphSpread;
      offset.x = -(pos.x - center.x) * pull * intensity * 0.2 * morphSpread;
      offset.z = -(pos.z - center.z) * pull * intensity * 0.2 * morphSpread;
      localIntensity = pull;
    }

    // 16: Bend - true arc deformation around X axis (steady)
    else if (morphType == 16) {
      float bendAngle = (pos.y - center.y) * intensity * morphSpread;
      float c = cos(bendAngle);
      float s = sin(bendAngle);
      // Rotate around X axis: y/z plane
      vec3 bent = vec3(pos.x, pos.y * c - pos.z * s, pos.y * s + pos.z * c);
      offset = bent - pos;
      localIntensity = abs(bendAngle);
    }

    // 17: Pixelate - true voxel snap (cubes formed by quantizing position)
    else if (morphType == 17) {
      // morphScale controls voxel resolution; spread controls offset magnitude from center.
      float voxelSize = max(0.04, 0.5 / max(morphScale, 0.1));
      vec3 snapped = floor(pos / voxelSize + 0.5) * voxelSize;
      offset = (snapped - pos) * intensity * morphSpread;
      localIntensity = intensity;
    }

    // 18: Swirl - helical vortex (twist + outward push, both scale with spread)
    else if (morphType == 18) {
      float r = length(vec2(pos.x - center.x, pos.z - center.z));
      float angle = atan(pos.z - center.z, pos.x - center.x);
      // Twist angle grows with height and time
      float swirl = (pos.y - center.y) * morphScale + t * morphSpeed * 0.5;
      angle += swirl * intensity;
      float pushR = r * (1.0 + intensity * morphSpread * 0.3);
      vec3 swirled = vec3(
        center.x + cos(angle) * pushR,
        pos.y,
        center.z + sin(angle) * pushR
      );
      offset = swirled - pos;
      localIntensity = intensity;
    }

    // 19: Fracture - split into chunks that drift along their own outward axis
    else if (morphType == 19) {
      // Chunks indexed by floor of scaled position; each chunk has a stable random direction.
      vec3 chunkId = floor(pos * morphScale * 0.5);
      float seed = snoise(chunkId * 7.0);
      vec3 chunkDir = normalize(vec3(
        snoise(chunkId * 3.1 + 11.0),
        snoise(chunkId * 3.1 + 22.0),
        snoise(chunkId * 3.1 + 33.0)
      ) + (pos - center) * 0.4);
      // Slight per-chunk separation amount based on seed
      float separation = (0.6 + abs(seed) * 0.6) * intensity * morphSpread;
      offset = chunkDir * separation;
      localIntensity = intensity;
    }

    vMorphIntensity = localIntensity;
    return (pos + offset) / assetToCanonical;
  }

  void main() {
    vUv = uv;

    // Use original position for morphing to avoid cumulative errors
    vec3 pos = originalPosition;
    vec3 norm = originalNormal;

    // Apply morphing deformation
    vec3 morphedPosition = applyMorph(pos, norm);
    vec3 morphedNormal = norm;

    // Apply skeletal animation (skinning) if present
    #ifdef USE_SKINNING
      mat4 boneMatX = getBoneMatrix( skinIndex.x );
      mat4 boneMatY = getBoneMatrix( skinIndex.y );
      mat4 boneMatZ = getBoneMatrix( skinIndex.z );
      mat4 boneMatW = getBoneMatrix( skinIndex.w );

      // Transform position by bone matrices
      vec4 skinVertex = bindMatrix * vec4( morphedPosition, 1.0 );
      vec4 skinned = vec4( 0.0 );
      skinned += boneMatX * skinVertex * skinWeight.x;
      skinned += boneMatY * skinVertex * skinWeight.y;
      skinned += boneMatZ * skinVertex * skinWeight.z;
      skinned += boneMatW * skinVertex * skinWeight.w;
      morphedPosition = ( bindMatrixInverse * skinned ).xyz;

      // Transform normal by bone matrices
      mat4 skinMatrix = mat4( 0.0 );
      skinMatrix += skinWeight.x * boneMatX;
      skinMatrix += skinWeight.y * boneMatY;
      skinMatrix += skinWeight.z * boneMatZ;
      skinMatrix += skinWeight.w * boneMatW;
      skinMatrix = bindMatrixInverse * skinMatrix * bindMatrix;
      morphedNormal = vec3( skinMatrix * vec4( norm, 0.0 ) );
    #endif

    vPosition = morphedPosition;
    vNormal = normalMatrix * morphedNormal;

    vec4 worldPos = modelMatrix * vec4(morphedPosition, 1.0);
    vWorldPosition = worldPos.xyz;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(morphedPosition, 1.0);
  }
`;

const wireframeVertexShader = morphingVertexShader
  .replace(
    'varying float vMorphIntensity;',
    'varying float vMorphIntensity;\n  attribute vec3 barycentric;\n  varying vec3 vBarycentric;',
  )
  .replace(
    'void main() {\n    vUv = uv;',
    'void main() {\n    vBarycentric = barycentric;\n    vUv = uv;',
  );

const wireframeFragmentShader = `
  varying vec3 vBarycentric;
  varying vec3 vWorldPosition;

  uniform float time;
  uniform int wireMode;
  uniform vec3 wireColor;
  uniform float wireOpacity;
  uniform float wireThickness;
  uniform float wireAnimSpeed;

  vec3 hueToRgb(float hue) {
    return clamp(
      abs(mod(hue * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0,
      0.0,
      1.0
    );
  }

  void main() {
    vec3 pixelWidth = fwidth(vBarycentric);
    float thickness = max(wireThickness, 0.25);
    if (wireMode == 8) thickness = max(thickness * 2.4, 3.5);

    vec3 edgeDistance = smoothstep(
      vec3(0.0),
      pixelWidth * thickness,
      vBarycentric
    );
    float edge = 1.0 - min(min(edgeDistance.x, edgeDistance.y), edgeDistance.z);
    float alpha = edge * wireOpacity;
    vec3 color = wireColor;

    if (wireMode == 2) {
      // Bright packets travel through the mesh instead of merely changing
      // the whole overlay's opacity.
      float flow = fract(
        dot(vWorldPosition, vec3(1.7, 2.3, 1.1))
        - time * max(wireAnimSpeed, 0.01) * 1.8
      );
      float packet = smoothstep(0.05, 0.28, flow) * (1.0 - smoothstep(0.45, 0.72, flow));
      alpha *= 0.18 + packet * 1.25;
      color = mix(color * 0.45, min(vec3(1.0), color * 1.8), packet);
    } else if (wireMode == 3 || wireMode == 4) {
      vec3 haloDistance = smoothstep(
        vec3(0.0),
        pixelWidth * thickness * (wireMode == 3 ? 3.8 : 2.4),
        vBarycentric
      );
      float halo = 1.0 - min(min(haloDistance.x, haloDistance.y), haloDistance.z);
      float core = pow(edge, wireMode == 4 ? 0.3 : 0.75);
      alpha = (halo * 0.38 + core) * wireOpacity;
      if (wireMode == 4) color = mix(color, vec3(1.0), core * 0.65);
    } else if (wireMode == 5) {
      float pulse = 0.5 + 0.5 * sin(time * max(wireAnimSpeed, 0.01) * 4.0);
      alpha *= 0.3 + pulse * 0.9;
      color = mix(color * 0.55, min(vec3(1.0), color * 1.75), pulse);
    } else if (wireMode == 6) {
      float hue = fract(
        dot(vWorldPosition, vec3(0.19, 0.27, 0.13))
        - time * max(wireAnimSpeed, 0.01) * 0.12
      );
      color = hueToRgb(hue);
    } else if (wireMode == 7) {
      // Screen-space stippling remains crisp at any model scale.
      float dotted = step(
        0.48,
        fract((gl_FragCoord.x + gl_FragCoord.y * 0.65) * 0.105
          - time * wireAnimSpeed * 0.9)
      );
      alpha *= dotted;
    }

    if (alpha <= 0.001) discard;
    gl_FragColor = vec4(color, clamp(alpha, 0.0, 1.0));
  }
`;

export function createModel3DWireframeGeometry(
  source: THREE.BufferGeometry,
): THREE.BufferGeometry {
  const geometry = source.index ? source.toNonIndexed() : source.clone();
  const positions = geometry.getAttribute('position');
  const barycentric = new Float32Array(positions.count * 3);

  for (let index = 0; index < positions.count; index += 3) {
    barycentric.set([
      1, 0, 0,
      0, 1, 0,
      0, 0, 1,
    ], index * 3);
  }

  geometry.setAttribute('barycentric', new THREE.BufferAttribute(barycentric, 3));
  return geometry;
}

export function getModel3DMorphReferenceSize(modelSize: number): number {
  return Number.isFinite(modelSize) ? Math.max(modelSize, 0.0001) : 1;
}

export function getModel3DWireframeModeIndex(mode: Model3DWireframeMode): number {
  const shaderMap: Record<Model3DWireframeMode, number> = {
    none: 0,
    classic: 1,
    animated: 2,
    glow: 3,
    neon: 4,
    pulse: 5,
    rainbow: 6,
    dotted: 7,
    thick: 8,
  };
  return shaderMap[mode];
}

// Source materials keep the GLB/FBX textures and PBR setup supplied by the
// model. Inject only the deformation stage into Three's stock vertex shader so
// those materials can use the same effects as Ghost Arcade's custom materials.
const sourceMaterialMorphChunk = morphingVertexShader
  .slice(
    morphingVertexShader.indexOf('attribute vec3 originalPosition;'),
    morphingVertexShader.indexOf('void main()'),
  )
  .replace('varying vec3 vPosition;', '')
  .replace('varying vec3 vNormal;', '')
  .replace('varying vec3 vWorldPosition;', '')
  .replace('varying vec2 vUv;', '');

const vertexDecorationMorphChunk = sourceMaterialMorphChunk
  .replace('attribute vec3 originalPosition;', '')
  .replace('attribute vec3 originalNormal;', '');

const vertexDecorationVertexShader = `
  attribute vec3 markerRestPosition;
  attribute vec3 markerRestNormal;

  ${vertexDecorationMorphChunk}

  void main() {
    vMorphIntensity = 0.0;
    vec3 markerCenter = applyMorph(markerRestPosition, normalize(markerRestNormal));
    gl_Position = projectionMatrix * modelViewMatrix * vec4(markerCenter + position, 1.0);
  }
`;

const vertexDecorationFragmentShader = `
  uniform vec3 markerColor;
  uniform float markerOpacity;

  void main() {
    gl_FragColor = vec4(markerColor, markerOpacity);
  }
`;

export function injectModel3DSourceMorphVertexShader(vertexShader: string): string {
  const requiredChunks = [
    '#include <common>',
    '#include <beginnormal_vertex>',
    '#include <begin_vertex>',
  ];
  const missingChunk = requiredChunks.find((chunk) => !vertexShader.includes(chunk));
  if (missingChunk) {
    throw new Error(`Model3D deformation shader is missing Three.js hook ${missingChunk}`);
  }

  return vertexShader
    .replace(
      '#include <common>',
      `#include <common>\n${sourceMaterialMorphChunk}`,
    )
    .replace(
      '#include <beginnormal_vertex>',
      [
        '#include <beginnormal_vertex>',
        'objectNormal = originalNormal;',
      ].join('\n'),
    )
    .replace(
      '#include <begin_vertex>',
      [
        '#include <begin_vertex>',
        'vMorphIntensity = 0.0;',
        'transformed = applyMorph(originalPosition, originalNormal);',
      ].join('\n'),
    );
}

type SourceMorphUniforms = {
  time: THREE.IUniform<number>;
  morphIntensity: THREE.IUniform<number>;
  morphType: THREE.IUniform<number>;
  morphSpeed: THREE.IUniform<number>;
  morphScale: THREE.IUniform<number>;
  morphPhase: THREE.IUniform<number>;
  morphCenter: THREE.IUniform<THREE.Vector3>;
  morphReferenceSize: THREE.IUniform<number>;
  audioLevel: THREE.IUniform<number>;
  audioMorphResponse: THREE.IUniform<number>;
  morphSpread: THREE.IUniform<number>;
};

export function getModel3DMorphTypeIndex(type: Model3DDeformationType): number {
  const shaderMap: Record<Model3DDeformationType, number> = {
    'none': 0,
    'noise': 1,
    'pulse': 2,
    'wave': 3,
    'twist': 4,
    'inflate': 5,
    'breathe': 5,
    'bulge': 6,
    'jelly': 7,
    'explode': 8,
    'implode': 9,
    'melt': 10,
    'spherify': 11,
    'taper': 12,
    'tentacle': 13,
    'shatter': 14,
    'magnetic': 15,
    'bend': 16,
    'pixelate': 17,
    'swirl': 18,
    'fracture': 19,
  };
  return shaderMap[type] ?? 0;
}

// ============================================================================
// FRAGMENT SHADERS FOR DIFFERENT MATERIALS
// ============================================================================

const standardFragmentShader = `
  uniform vec3 baseColor;
  uniform float opacity;
  uniform float roughness;
  uniform float metalness;
  uniform vec3 emissiveColor;
  uniform float emissiveIntensity;
  uniform vec3 lightDir;
  uniform vec3 lightColor;
  uniform float ambientIntensity;
  uniform float directionalIntensity;
  uniform float shadowsEnabled;
  uniform float shadowStrength;
  uniform float shadowSoftness;
  uniform float time;

  varying vec3 vPosition;
  varying vec3 vNormal;
  varying vec3 vWorldPosition;
  varying vec2 vUv;
  varying float vMorphIntensity;

  void main() {
    vec3 normal = normalize(vNormal);
    vec3 light = normalize(lightDir);

    // Custom deformation materials do not participate in Three.js shadow-map
    // chunks, so preserve a visible self-shadow response in the same lighting
    // profile used by source PBR materials.
    float signedNdotL = dot(normal, light);
    float NdotL = max(signedNdotL, 0.0);
    float edge = mix(0.02, 0.45, clamp(shadowSoftness / 4.0, 0.0, 1.0));
    float litFacing = smoothstep(-edge, edge, signedNdotL);
    float selfShadow = mix(
      1.0,
      mix(0.28, 1.0, litFacing),
      clamp(shadowsEnabled * shadowStrength, 0.0, 1.0)
    );
    vec3 diffuse = baseColor * NdotL * lightColor * directionalIntensity * selfShadow;

    // Ambient (driven by panel slider — was hard-coded 0.3 before).
    float ambientShadow = mix(
      1.0,
      0.72 + 0.28 * litFacing,
      clamp(shadowsEnabled * shadowStrength, 0.0, 1.0)
    );
    vec3 ambient = baseColor * ambientIntensity * ambientShadow;

    // Emissive
    vec3 emissive = emissiveColor * emissiveIntensity;

    // Add subtle glow at morph areas
    emissive += emissiveColor * vMorphIntensity * 0.3;

    vec3 color = ambient + diffuse + emissive;

    gl_FragColor = vec4(color, opacity);
  }
`;

const hologramFragmentShader = `
  uniform float time;
  uniform float opacity;
  uniform vec3 baseColor;
  uniform vec3 rimColor;
  uniform float scanSpeed;
  uniform float scanCount;
  uniform float glitchIntensity;

  varying vec3 vPosition;
  varying vec3 vNormal;
  varying vec3 vWorldPosition;
  varying vec2 vUv;
  varying float vMorphIntensity;

  float random(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
  }

  void main() {
    vec3 viewDir = normalize(cameraPosition - vWorldPosition);
    float fresnel = pow(1.0 - abs(dot(viewDir, normalize(vNormal))), 2.0);

    // Scanlines
    float scan = sin(vWorldPosition.y * scanCount + time * scanSpeed) * 0.5 + 0.5;
    scan = pow(scan, 0.5);

    // Glitch effect
    float glitch = 0.0;
    if (glitchIntensity > 0.0) {
      float glitchLine = step(0.99 - glitchIntensity * 0.1, random(vec2(floor(vWorldPosition.y * 20.0), floor(time * 10.0))));
      glitch = glitchLine * random(vec2(time, vWorldPosition.x)) * glitchIntensity;
    }

    vec3 color = mix(baseColor, rimColor, fresnel);
    color += rimColor * scan * 0.3;
    color += vec3(glitch);

    // Boost color at morphing areas
    color += rimColor * vMorphIntensity * 0.5;

    float flicker = 0.95 + 0.05 * sin(time * 50.0);
    color *= flicker;

    float alpha = (fresnel * 0.5 + 0.3 + scan * 0.2) * opacity;

    gl_FragColor = vec4(color, alpha);
  }
`;

const lavaFragmentShader = `
  uniform float time;
  uniform float opacity;
  uniform vec3 baseColor;
  uniform vec3 glowColor;
  uniform float flowSpeed;
  uniform float crackIntensity;

  varying vec3 vPosition;
  varying vec3 vNormal;
  varying vec3 vWorldPosition;
  varying vec2 vUv;
  varying float vMorphIntensity;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

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

  float fbm(vec2 p) {
    float f = 0.0;
    f += 0.5 * noise(p); p *= 2.01;
    f += 0.25 * noise(p); p *= 2.02;
    f += 0.125 * noise(p); p *= 2.03;
    f += 0.0625 * noise(p);
    return f;
  }

  void main() {
    vec2 uv = vUv * 4.0;

    float flow = fbm(uv + vec2(time * flowSpeed * 0.2, time * flowSpeed * 0.1));
    float flow2 = fbm(uv * 1.5 + vec2(-time * flowSpeed * 0.15, time * flowSpeed * 0.12));

    float cracks = pow(1.0 - fbm(uv * 3.0 + flow * 0.5), 3.0 * crackIntensity);

    vec3 darkLava = baseColor * 0.08;
    vec3 midLava = baseColor;
    vec3 brightLava = glowColor;

    float heat = flow * 0.6 + flow2 * 0.4;
    heat = pow(heat, 0.8);

    // Boost heat at morph areas
    heat += vMorphIntensity * 0.3;
    heat = min(heat, 1.0);

    vec3 color = mix(darkLava, midLava, heat);
    color = mix(color, brightLava, cracks * heat);
    color += brightLava * (heat * 0.5 + cracks * 0.5) * 0.3;

    gl_FragColor = vec4(color, opacity);
  }
`;

const dissolveFragmentShader = `
  uniform float time;
  uniform float opacity;
  uniform vec3 baseColor;
  uniform vec3 edgeColor;
  uniform float dissolveAmount;
  uniform float edgeWidth;

  varying vec3 vPosition;
  varying vec3 vNormal;
  varying vec3 vWorldPosition;
  varying vec2 vUv;
  varying float vMorphIntensity;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float noise3D(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
                   mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                   mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }

  void main() {
    float n = noise3D(vPosition * 3.0);
    n += noise3D(vPosition * 6.0) * 0.5;
    n += noise3D(vPosition * 12.0) * 0.25;
    n = n / 1.75;

    float threshold = dissolveAmount;

    if (n < threshold) {
      discard;
    }

    float edge = smoothstep(threshold, threshold + edgeWidth, n);
    vec3 color = mix(edgeColor, baseColor, edge);
    float edgeGlow = 1.0 - edge;
    color += edgeColor * edgeGlow * 2.0;

    gl_FragColor = vec4(color, opacity * edge + edgeGlow * 0.5);
  }
`;

const fresnelFragmentShader = `
  uniform float opacity;
  uniform vec3 baseColor;
  uniform vec3 fresnelColor;
  uniform float fresnelPower;
  uniform float baseOpacity;

  varying vec3 vPosition;
  varying vec3 vNormal;
  varying vec3 vWorldPosition;
  varying vec2 vUv;
  varying float vMorphIntensity;

  void main() {
    vec3 viewDir = normalize(cameraPosition - vWorldPosition);
    float fresnel = pow(1.0 - abs(dot(viewDir, normalize(vNormal))), fresnelPower);

    // Boost fresnel at morph areas
    fresnel += vMorphIntensity * 0.3;
    fresnel = min(fresnel, 1.0);

    vec3 color = mix(baseColor * baseOpacity, fresnelColor, fresnel);
    float alpha = mix(baseOpacity, 1.0, fresnel) * opacity;

    gl_FragColor = vec4(color, alpha);
  }
`;

const xrayFragmentShader = `
  uniform float opacity;
  uniform vec3 baseColor;
  uniform float edgeIntensity;

  varying vec3 vPosition;
  varying vec3 vNormal;
  varying vec3 vWorldPosition;
  varying vec2 vUv;
  varying float vMorphIntensity;

  void main() {
    vec3 viewDir = normalize(cameraPosition - vWorldPosition);
    float edge = pow(1.0 - abs(dot(viewDir, normalize(vNormal))), edgeIntensity);

    vec3 color = baseColor * edge;
    // Highlight morph areas
    color += baseColor * vMorphIntensity * 0.5;

    float alpha = edge * opacity;

    gl_FragColor = vec4(color, alpha);
  }
`;

const neonFragmentShader = `
  uniform float time;
  uniform float opacity;
  uniform vec3 baseColor;
  uniform float glowIntensity;
  uniform float pulseSpeed;

  varying vec3 vPosition;
  varying vec3 vNormal;
  varying vec3 vWorldPosition;
  varying vec2 vUv;
  varying float vMorphIntensity;

  void main() {
    vec3 viewDir = normalize(cameraPosition - vWorldPosition);
    float fresnel = pow(1.0 - abs(dot(viewDir, normalize(vNormal))), 2.0);

    // Pulsing glow
    float pulse = sin(time * pulseSpeed) * 0.3 + 0.7;

    vec3 color = baseColor * (1.0 + fresnel * glowIntensity * pulse);

    // Extra glow at morph areas
    color += baseColor * vMorphIntensity * glowIntensity * 0.5;

    float alpha = opacity;

    gl_FragColor = vec4(color, alpha);
  }
`;

const iceFragmentShader = `
  uniform float time;
  uniform float opacity;
  uniform vec3 baseColor;
  uniform float refraction;
  uniform float frostiness;

  varying vec3 vPosition;
  varying vec3 vNormal;
  varying vec3 vWorldPosition;
  varying vec2 vUv;
  varying float vMorphIntensity;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  void main() {
    vec3 viewDir = normalize(cameraPosition - vWorldPosition);
    float fresnel = pow(1.0 - abs(dot(viewDir, normalize(vNormal))), 2.0);

    // Frost pattern
    float frost = hash(floor(vUv * 20.0)) * frostiness;

    // Refracted color shift
    vec3 refractColor = baseColor * (1.0 + refraction * 0.2 * sin(vUv.x * 10.0 + time));

    vec3 color = mix(refractColor, vec3(1.0), fresnel * 0.5 + frost * 0.3);

    // Crystalline sparkle at morph areas
    color += vec3(1.0) * vMorphIntensity * 0.3;

    float alpha = opacity * (0.7 + fresnel * 0.3);

    gl_FragColor = vec4(color, alpha);
  }
`;

const chromeFragmentShader = `
  uniform float time;
  uniform float opacity;
  uniform float reflectivity;
  uniform vec3 tintColor;

  varying vec3 vPosition;
  varying vec3 vNormal;
  varying vec3 vWorldPosition;
  varying vec2 vUv;
  varying float vMorphIntensity;

  void main() {
    vec3 viewDir = normalize(cameraPosition - vWorldPosition);
    vec3 reflectDir = reflect(-viewDir, normalize(vNormal));

    // Fake environment reflection
    float r = reflectDir.y * 0.5 + 0.5;
    vec3 skyColor = mix(vec3(0.3, 0.3, 0.4), vec3(0.9, 0.95, 1.0), r);

    // Chrome tint
    vec3 color = mix(vec3(0.8, 0.8, 0.85), skyColor, reflectivity);
    color *= mix(vec3(1.0), tintColor, 0.75);

    // Morph area highlights
    color += vec3(1.0) * vMorphIntensity * 0.3;

    gl_FragColor = vec4(color, opacity);
  }
`;

const glassFragmentShader = `
  uniform float time;
  uniform float opacity;
  uniform vec3 baseColor;
  uniform float thickness;
  uniform float ior;

  varying vec3 vPosition;
  varying vec3 vNormal;
  varying vec3 vWorldPosition;
  varying vec2 vUv;
  varying float vMorphIntensity;

  void main() {
    vec3 viewDir = normalize(cameraPosition - vWorldPosition);
    vec3 normal = normalize(vNormal);

    float fresnel = pow(1.0 - abs(dot(viewDir, normal)), 3.0);

    // Glass color with thickness-based absorption
    vec3 color = baseColor * (1.0 - thickness * 0.3);
    color = mix(color, vec3(1.0), fresnel * 0.8);

    // Chromatic aberration at edges
    color.r += fresnel * 0.1;
    color.b -= fresnel * 0.1;

    float alpha = mix(0.1, 0.8, fresnel) * opacity;

    gl_FragColor = vec4(color, alpha);
  }
`;

// ============================================================================
// MODEL3D RENDERER CLASS
// ============================================================================

export class Model3DRenderer {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private model: THREE.Group | null = null;
  private echoInstances: THREE.Group[] = [];
  private lights: THREE.Light[] = [];
  private ambientLight: THREE.AmbientLight | null = null;
  private keyLight: THREE.DirectionalLight | null = null;
  private fillLight: THREE.DirectionalLight | null = null;
  private rimLight: THREE.DirectionalLight | null = null;
  private environmentMap: THREE.Texture | null = null;
  private environmentRenderer: THREE.WebGLRenderer | null = null;
  private environmentBackdrop: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial> | null = null;
  private rendererClearColor = new THREE.Color();
  private startTime: number = 0;

  // Per-frame rebuild caches — these scenegraphs are expensive to construct
  // (EdgesGeometry + many Mesh allocations + deep .clone()). Rebuild only
  // when the *structural* inputs change; per-frame updates mutate transforms
  // and material color/opacity in place.
  // Echo mesh ↔ source mesh mapping. Built when echoes are (re)cached.
  // We share uniform values from source → echo every frame so that live
  // deformation/material edits show up on echoes without restarting them.
  private _echoMeshPairs: { sourceMesh: THREE.Mesh; echoMesh: THREE.Mesh }[][] = [];

  private _wireframeCacheKey: string | null = null;
  private _wireframeMeshes: { overlay: THREE.Mesh; src: THREE.Mesh }[] = [];
  private _vertexDecoCacheKey: string | null = null;
  private _vertexDecorationMeshes: THREE.InstancedMesh[] = [];
  private _vertexDecorationMaterials: THREE.ShaderMaterial[] = [];
  private _echoCacheKey: string | null = null;
  private modelTriangleCount = 0;
  private modelMeshCount = 0;

  // Original geometry data for morphing
  private originalPositions: Map<string, Float32Array> = new Map();
  private originalNormals: Map<string, Float32Array> = new Map();

  // Loaders
  private gltfLoader: GLTFLoader;
  private objLoader: OBJLoader;
  private fbxLoader: FBXLoader;

  // Current state
  private currentContent: Model3DContent | null = null;
  private modelBounds: THREE.Box3 = new THREE.Box3();
  private modelCenter: THREE.Vector3 = new THREE.Vector3();
  private modelSize: number = 1;
  private lastShadowSignature = '';

  // GLTF/FBX embedded animation support
  private mixer: THREE.AnimationMixer | null = null;
  private animationActions: THREE.AnimationAction[] = [];
  private animationClips: THREE.AnimationClip[] = [];
  private clock: THREE.Clock = new THREE.Clock();
  private hasFileAnimations: boolean = false;

  /**
   * Create a Model3DRenderer.
   * @param canvasOrWidth - HTMLCanvasElement for standalone mode, or width (number) for shared-renderer mode
   * @param height - Required when canvasOrWidth is a number
   */
  constructor(canvasOrWidth: HTMLCanvasElement | number, height?: number) {
    // Create scene
    this.scene = new THREE.Scene();
    this.scene.background = null;

    if (typeof canvasOrWidth === 'number') {
      // Shared-renderer mode: no own WebGL context — use renderTo() with main engine's renderer
      const w = canvasOrWidth;
      const h = height || 1080;
      this.camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 1000);
      this.camera.position.z = 5;
    } else {
      // Standalone mode: creates own WebGL context
      this.canvas = canvasOrWidth;
      this.camera = new THREE.PerspectiveCamera(50, canvasOrWidth.width / canvasOrWidth.height, 0.1, 1000);
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
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1;
    }

    // Initialize loaders
    this.gltfLoader = new GLTFLoader();
    this.objLoader = new OBJLoader();
    this.fbxLoader = new FBXLoader();

    this.startTime = performance.now();

    // Setup default lighting
    this.setupLighting('studio');
  }

  // Load 3D model from data URL or blob URL
  async loadModel(dataUrl: string, format: string): Promise<{ vertexCount: number; faceCount: number; hasAnimations: boolean }> {
    return new Promise((resolve, reject) => {
      // Clear existing model
      this.clearWireframeOverlays();
      this.clearVertexDecorations();
      this.clearEchoInstances();
      if (this.model) {
        this.scene.remove(this.model);
        this.disposeObject(this.model);
        this.model = null;
      }
      this.originalPositions.clear();
      this.originalNormals.clear();
      // Invalidate per-frame caches — they keyed off the old model's uuid.
      this._wireframeCacheKey = null;
      this._wireframeMeshes = [];
      this._vertexDecoCacheKey = null;
      this._vertexDecorationMeshes = [];
      this._vertexDecorationMaterials = [];
      this._echoCacheKey = null;
      this._echoMeshPairs = [];
      this.modelTriangleCount = 0;
      this.modelMeshCount = 0;
      // Force the morph ShaderMaterial to be re-applied to the freshly-loaded
      // model's meshes — otherwise the original GLB/FBX materials stay in
      // place and the user sees the embedded textures with no morph shader,
      // making deformation/animation effects appear to do nothing.
      this._cachedMaterialKey = '';
      this._cachedMaterial = null;
      // Also reset lighting so setupLighting actually rebuilds for the new model.
      this._lastLightingPreset = '';

      // Clean up existing animation mixer
      if (this.mixer) {
        this.mixer.stopAllAction();
        this.mixer = null;
      }
      this.animationActions = [];
      this.animationClips = [];
      this.hasFileAnimations = false;
      this.clock = new THREE.Clock();

      const onLoad = (object: THREE.Object3D) => {
        const sourceRoot = object instanceof THREE.Group ? object : new THREE.Group().add(object);

        // Normalize the imported hierarchy inside a stable transform root.
        // The root owns all user transforms, while the source stays centered
        // permanently so rotations occur around the object's actual center.
        this.modelBounds.setFromObject(sourceRoot);
        this.modelBounds.getCenter(this.modelCenter);
        this.modelSize = Math.max(this.modelBounds.getSize(new THREE.Vector3()).length(), 0.0001);
        sourceRoot.position.sub(this.modelCenter);
        this.model = new THREE.Group();
        this.model.name = 'GhostArcadeModelTransformRoot';
        this.model.add(sourceRoot);

        // Auto-scale to fit view
        const scale = 2 / this.modelSize;
        this.model.scale.setScalar(scale);
        this.lastShadowSignature = '';

        // Store original positions for morphing and add attributes
        let meshIndex = 0;
        this.model.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            // Keep the loader-provided material alive. GLB/GLTF textures live
            // on these materials; replacing and disposing them is what made
            // textured scans render as flat gray.
            child.userData.sourceMaterial = child.material;
            child.castShadow = true;
            child.receiveShadow = true;
            const geometry = child.geometry;
            if (!geometry.attributes.normal) {
              geometry.computeVertexNormals();
            }
            const positions = geometry.attributes.position.array as Float32Array;
            const normals = geometry.attributes.normal.array as Float32Array;

            // Store originals
            const key = `mesh_${meshIndex}`;
            this.originalPositions.set(key, new Float32Array(positions));
            this.originalNormals.set(key, new Float32Array(normals));

            // Add original position/normal as attributes for shader
            geometry.setAttribute('originalPosition', new THREE.BufferAttribute(new Float32Array(positions), 3));
            geometry.setAttribute('originalNormal', new THREE.BufferAttribute(new Float32Array(normals), 3));

            child.userData.meshKey = key;
            meshIndex++;
          }
        });

        this.scene.add(this.model);

        // Setup AnimationMixer for embedded animations (GLTF/FBX)
        if (this.animationClips.length > 0) {
          this.hasFileAnimations = true;
          // Animation track paths belong to the imported hierarchy, not the
          // normalization wrapper that Ghost Arcade adds around it.
          this.mixer = new THREE.AnimationMixer(sourceRoot);
          for (const clip of this.animationClips) {
            const action = this.mixer.clipAction(clip);
            action.play();
            this.animationActions.push(action);
          }
          console.log(`[Model3DRenderer] Loaded ${this.animationClips.length} embedded animation(s)`);
        }

        // Count vertices and faces
        let vertexCount = 0;
        let faceCount = 0;
        let meshCount = 0;

        this.model.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            meshCount++;
            const geometry = child.geometry;
            if (geometry.attributes.position) {
              vertexCount += geometry.attributes.position.count;
            }
            if (geometry.index) {
              faceCount += geometry.index.count / 3;
            } else if (geometry.attributes.position) {
              faceCount += geometry.attributes.position.count / 3;
            }
          }
        });
        this.modelTriangleCount = faceCount;
        this.modelMeshCount = meshCount;

        resolve({ vertexCount, faceCount, hasAnimations: this.hasFileAnimations });
      };

      const onError = (error: unknown) => {
        console.error('Failed to load 3D model:', error);
        reject(error instanceof Error ? error : new Error(String(error)));
      };

      switch (format) {
        case 'glb':
        case 'gltf':
          this.gltfLoader.load(dataUrl, (gltf) => {
            // Capture embedded animations before processing scene
            this.animationClips = gltf.animations || [];
            onLoad(gltf.scene);
          }, undefined, onError);
          break;

        case 'obj':
          this.objLoader.load(dataUrl, onLoad, undefined, onError);
          break;

        case 'fbx':
          this.fbxLoader.load(dataUrl, (fbx) => {
            // FBX files can also contain animations
            this.animationClips = fbx.animations || [];
            onLoad(fbx);
          }, undefined, onError);
          break;

        default:
          reject(new Error(`Unsupported format: ${format}`));
      }
    });
  }

  // Setup lighting based on preset
  private _lastLightingPreset: string = '';

  private setupLighting(preset: Model3DLightingPreset) {
    // Rebuild only when the preset changes. The four-light rig remains stable
    // between frames so live parameter edits do not churn scene objects.
    if (preset === this._lastLightingPreset) return;
    this._lastLightingPreset = preset;

    this.lights.forEach((light) => this.scene.remove(light));
    this.lights = [];
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    this.keyLight = new THREE.DirectionalLight(0xffffff, 1);
    this.fillLight = new THREE.DirectionalLight(0x9bbcff, 0.35);
    this.rimLight = new THREE.DirectionalLight(0x78b4ff, 0.4);

    this.keyLight.castShadow = true;
    this.keyLight.shadow.camera.near = 0.1;
    this.keyLight.shadow.camera.far = 30;
    this.keyLight.shadow.camera.left = -5;
    this.keyLight.shadow.camera.right = 5;
    this.keyLight.shadow.camera.top = 5;
    this.keyLight.shadow.camera.bottom = -5;
    this.lastShadowSignature = '';

    this.lights.push(this.ambientLight, this.keyLight, this.fillLight, this.rimLight);

    if (preset === 'disco') {
      const colors = [0xff3355, 0x33ff88, 0x4488ff, 0xffcc33, 0xff33dd, 0x33ddff];
      colors.forEach((color, i) => {
        const light = new THREE.PointLight(color, 0.5, 16, 2);
        const angle = (i / colors.length) * Math.PI * 2;
        light.position.set(Math.cos(angle) * 5, 2, Math.sin(angle) * 5);
        light.userData.discoIndex = i;
        this.lights.push(light);
      });
    }

    this.lights.forEach((light) => this.scene.add(light));
  }

  private updateLightingRig(content: Model3DContent, time: number) {
    if (!this.ambientLight || !this.keyLight || !this.fillLight || !this.rimLight) return;

    const preset = content.lightingPreset;
    const profile = getModel3DLightingProfile(preset);

    this.ambientLight.intensity = (content.ambientIntensity ?? 0.4) * profile.ambientScale;
    this.keyLight.intensity = (content.directionalIntensity ?? 1) * profile.keyScale;
    this.fillLight.intensity = (content.fillIntensity ?? 0.35) * profile.fillScale;
    this.rimLight.intensity = (content.rimIntensity ?? 0.4) * profile.rimScale;

    const keyColor = this.getLightColorForPreset(preset, content.lightColor, time);
    this.keyLight.color.copy(keyColor);
    this.fillLight.color.copy(keyColor).lerp(new THREE.Color(0x88aaff), 0.45);
    const rim = content.rimColor ?? [120, 180, 255];
    this.rimLight.color.setRGB(rim[0] / 255, rim[1] / 255, rim[2] / 255);

    const lightDirection = this.getLightDirForPreset(
      preset,
      content.keyLightAzimuth ?? 45,
      content.keyLightElevation ?? 50,
    );
    const radius = 7;
    this.keyLight.position.copy(lightDirection).multiplyScalar(radius);
    this.fillLight.position.copy(this.keyLight.position).multiplyScalar(-0.75);
    this.fillLight.position.y = Math.max(0.5, Math.abs(this.fillLight.position.y) * 0.4);
    this.rimLight.position.set(-this.keyLight.position.x, 3.5, -this.keyLight.position.z);

    const shadowsEnabled = content.shadowsEnabled ?? true;
    const quality = content.shadowQuality ?? 'medium';
    const mapSize = quality === 'high' ? 2048 : quality === 'low' ? 512 : 1024;
    const signature = `${shadowsEnabled}:${mapSize}`;
    this.keyLight.castShadow = shadowsEnabled;
    this.keyLight.shadow.bias = content.shadowBias ?? -0.0005;
    this.keyLight.shadow.normalBias = Math.max(0, content.shadowSoftness ?? 1) * 0.015;
    this.keyLight.shadow.radius = Math.max(0, content.shadowSoftness ?? 1) * 2;
    if (signature !== this.lastShadowSignature) {
      this.lastShadowSignature = signature;
      this.keyLight.shadow.mapSize.set(mapSize, mapSize);
      this.keyLight.shadow.map?.dispose();
      this.model?.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = shadowsEnabled;
          child.receiveShadow = shadowsEnabled;
        }
      });
    }
  }

  // ── Lighting preset → shader uniforms ─────────────────────────────────────
  // The morph ShaderMaterial does its own lighting math (it can't sample the
  // scene's THREE.Light objects), so the lighting preset has to project into
  // these shader uniforms to actually change how the material looks.
  private _lightDirScratch = new THREE.Vector3();
  private _lightColorScratch = new THREE.Color();
  private getLightDirForPreset(
    preset: Model3DLightingPreset,
    azimuthDegrees?: number,
    elevationDegrees?: number,
  ): THREE.Vector3 {
    const profile = getModel3DLightingProfile(preset);
    const azimuth = THREE.MathUtils.degToRad(
      (Number.isFinite(azimuthDegrees) ? azimuthDegrees! : 45) + profile.azimuthOffset,
    );
    const elevation = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(
      (Number.isFinite(elevationDegrees) ? elevationDegrees! : 50) + profile.elevationOffset,
      -89,
      89,
    ));
    this._lightDirScratch.set(
      Math.cos(elevation) * Math.cos(azimuth),
      Math.sin(elevation),
      Math.cos(elevation) * Math.sin(azimuth),
    );
    return this._lightDirScratch.normalize();
  }
  private getLightColorForPreset(preset: Model3DLightingPreset, panelColor: [number, number, number] | undefined, time: number): THREE.Color {
    // Panel light color tints whatever the preset would return.
    const pr = (panelColor?.[0] ?? 255) / 255;
    const pg = (panelColor?.[1] ?? 255) / 255;
    const pb = (panelColor?.[2] ?? 255) / 255;
    switch (preset) {
      case 'studio':    this._lightColorScratch.setRGB(1, 1, 1); break;
      case 'dramatic':  this._lightColorScratch.setRGB(1, 0.95, 0.85); break;
      case 'neon': {
        // Lerp pink↔cyan to give the dual-light feel through one directional.
        const t = Math.sin(time * 0.7) * 0.5 + 0.5;
        this._lightColorScratch.setRGB(1 - t * 0.4, t * 0.6 + 0.2, 1);
        break;
      }
      case 'sunrise':   this._lightColorScratch.setRGB(1, 0.7, 0.4); break;
      case 'moonlight': this._lightColorScratch.setRGB(0.55, 0.65, 1); break;
      case 'disco': {
        // Cycle hue with time for the disco effect.
        const hue = (time * 0.6) % 1;
        this._lightColorScratch.setHSL(hue, 1, 0.6);
        break;
      }
      case 'none':
      default:          this._lightColorScratch.setRGB(1, 1, 1); break;
    }
    this._lightColorScratch.r *= pr;
    this._lightColorScratch.g *= pg;
    this._lightColorScratch.b *= pb;
    return this._lightColorScratch;
  }

  // Get morph type index
  private getMorphTypeIndex(type: Model3DDeformationType): number {
    return getModel3DMorphTypeIndex(type);
  }

  // Create shader material based on type
  private createMaterial(content: Model3DContent, time: number): THREE.Material {
    const color = new THREE.Color(
      content.materialColor[0] / 255,
      content.materialColor[1] / 255,
      content.materialColor[2] / 255
    );

    const lightDirVec = this.getLightDirForPreset(
      content.lightingPreset,
      content.keyLightAzimuth ?? 45,
      content.keyLightElevation ?? 50,
    );
    const lightColorVec = this.getLightColorForPreset(content.lightingPreset, content.lightColor, time);
    const lightingProfile = getModel3DLightingProfile(content.lightingPreset);

    const commonUniforms = {
      time: { value: time },
      morphIntensity: { value: content.deformationIntensity },
      morphType: { value: this.getMorphTypeIndex(content.deformationType) },
      morphSpeed: { value: content.deformationSpeed },
      morphScale: { value: content.deformationScale },
      morphSpread: { value: content.deformationSpread ?? 1 },
      morphPhase: { value: 0.0 },
      morphCenter: { value: new THREE.Vector3(0, 0, 0) },
      morphReferenceSize: { value: getModel3DMorphReferenceSize(this.modelSize) },
      audioLevel: { value: 0.0 },
      audioMorphResponse: { value: content.audio.deformResponse },
      ambientIntensity: { value: (content.ambientIntensity ?? 0.4) * lightingProfile.ambientScale },
      directionalIntensity: { value: (content.directionalIntensity ?? 1.0) * lightingProfile.keyScale },
      shadowsEnabled: { value: (content.shadowsEnabled ?? true) ? 1 : 0 },
      shadowStrength: { value: lightingProfile.selfShadowStrength },
      shadowSoftness: { value: content.shadowSoftness ?? 1 },
      lightDir: { value: lightDirVec.clone() },
      lightColor: { value: lightColorVec.clone() },
    };

    switch (content.materialType) {
      case 'standard':
        return new THREE.ShaderMaterial({
          vertexShader: morphingVertexShader,
          fragmentShader: standardFragmentShader,
          uniforms: {
            ...commonUniforms,
            baseColor: { value: color },
            opacity: { value: content.materialOpacity },
            roughness: { value: content.materialRoughness },
            metalness: { value: content.materialMetalness },
            emissiveColor: { value: new THREE.Color(
              content.materialEmissive[0] / 255,
              content.materialEmissive[1] / 255,
              content.materialEmissive[2] / 255
            )},
            emissiveIntensity: { value: content.materialEmissiveIntensity },
          },
          transparent: content.materialOpacity < 1,
          side: THREE.DoubleSide,
        });

      case 'wireframe':
        return new THREE.ShaderMaterial({
          vertexShader: morphingVertexShader,
          fragmentShader: standardFragmentShader,
          uniforms: {
            ...commonUniforms,
            baseColor: { value: color },
            opacity: { value: content.materialOpacity },
            roughness: { value: 1 },
            metalness: { value: 0 },
            emissiveColor: { value: color },
            emissiveIntensity: { value: 0.5 },
          },
          wireframe: true,
          transparent: true,
          side: THREE.DoubleSide,
        });

      case 'glass':
        return new THREE.ShaderMaterial({
          vertexShader: morphingVertexShader,
          fragmentShader: glassFragmentShader,
          uniforms: {
            ...commonUniforms,
            baseColor: { value: color },
            opacity: { value: content.materialOpacity },
            thickness: { value: content.glassThickness },
            ior: { value: content.glassIOR },
          },
          transparent: true,
          side: THREE.DoubleSide,
          depthWrite: false,
        });

      case 'chrome':
        return new THREE.ShaderMaterial({
          vertexShader: morphingVertexShader,
          fragmentShader: chromeFragmentShader,
          uniforms: {
            ...commonUniforms,
            opacity: { value: content.materialOpacity },
            reflectivity: { value: content.chromeReflectivity },
            tintColor: { value: color },
          },
          side: THREE.DoubleSide,
        });

      case 'hologram':
        return new THREE.ShaderMaterial({
          vertexShader: morphingVertexShader,
          fragmentShader: hologramFragmentShader,
          uniforms: {
            ...commonUniforms,
            opacity: { value: content.materialOpacity },
            baseColor: { value: color },
            rimColor: { value: new THREE.Color(
              content.hologramRimColor[0] / 255,
              content.hologramRimColor[1] / 255,
              content.hologramRimColor[2] / 255
            )},
            scanSpeed: { value: content.hologramScanSpeed },
            scanCount: { value: content.hologramScanCount },
            glitchIntensity: { value: content.hologramGlitchIntensity },
          },
          transparent: true,
          side: THREE.DoubleSide,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });

      case 'lava':
        return new THREE.ShaderMaterial({
          vertexShader: morphingVertexShader,
          fragmentShader: lavaFragmentShader,
          uniforms: {
            ...commonUniforms,
            opacity: { value: content.materialOpacity },
            baseColor: { value: color },
            glowColor: { value: new THREE.Color(
              content.lavaGlowColor[0] / 255,
              content.lavaGlowColor[1] / 255,
              content.lavaGlowColor[2] / 255
            )},
            flowSpeed: { value: content.lavaFlowSpeed },
            crackIntensity: { value: content.lavaCrackIntensity },
          },
          transparent: content.materialOpacity < 1,
          side: THREE.DoubleSide,
        });

      case 'ice':
        return new THREE.ShaderMaterial({
          vertexShader: morphingVertexShader,
          fragmentShader: iceFragmentShader,
          uniforms: {
            ...commonUniforms,
            baseColor: { value: color },
            opacity: { value: content.materialOpacity },
            refraction: { value: content.iceRefraction },
            frostiness: { value: content.iceFrostIntensity },
          },
          transparent: true,
          side: THREE.DoubleSide,
        });

      case 'neon':
        return new THREE.ShaderMaterial({
          vertexShader: morphingVertexShader,
          fragmentShader: neonFragmentShader,
          uniforms: {
            ...commonUniforms,
            baseColor: { value: color },
            opacity: { value: content.materialOpacity },
            glowIntensity: { value: content.materialEmissiveIntensity },
            pulseSpeed: { value: content.animationSpeed },
          },
          transparent: true,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
        });

      case 'xray':
        return new THREE.ShaderMaterial({
          vertexShader: morphingVertexShader,
          fragmentShader: xrayFragmentShader,
          uniforms: {
            ...commonUniforms,
            baseColor: { value: color },
            opacity: { value: content.materialOpacity },
            edgeIntensity: { value: 2.5 },
          },
          transparent: true,
          side: THREE.DoubleSide,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });

      case 'toon':
        return new THREE.ShaderMaterial({
          vertexShader: morphingVertexShader,
          fragmentShader: standardFragmentShader,
          uniforms: {
            ...commonUniforms,
            baseColor: { value: color },
            opacity: { value: content.materialOpacity },
            roughness: { value: 1 },
            metalness: { value: 0 },
            emissiveColor: { value: new THREE.Color(0, 0, 0) },
            emissiveIntensity: { value: 0 },
          },
          transparent: content.materialOpacity < 1,
          side: THREE.DoubleSide,
        });

      case 'fresnel':
        return new THREE.ShaderMaterial({
          vertexShader: morphingVertexShader,
          fragmentShader: fresnelFragmentShader,
          uniforms: {
            ...commonUniforms,
            baseColor: { value: color },
            fresnelColor: { value: new THREE.Color(
              content.fresnelColor[0] / 255,
              content.fresnelColor[1] / 255,
              content.fresnelColor[2] / 255
            )},
            fresnelPower: { value: content.fresnelPower },
            baseOpacity: { value: 0.1 },
            opacity: { value: content.materialOpacity },
          },
          transparent: true,
          side: THREE.DoubleSide,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });

      case 'dissolve':
        return new THREE.ShaderMaterial({
          vertexShader: morphingVertexShader,
          fragmentShader: dissolveFragmentShader,
          uniforms: {
            ...commonUniforms,
            baseColor: { value: color },
            edgeColor: { value: new THREE.Color(
              content.dissolveEdgeColor[0] / 255,
              content.dissolveEdgeColor[1] / 255,
              content.dissolveEdgeColor[2] / 255
            )},
            dissolveAmount: { value: content.dissolveAmount },
            edgeWidth: { value: content.dissolveEdgeWidth },
            opacity: { value: content.materialOpacity },
          },
          transparent: true,
          side: THREE.DoubleSide,
        });

      case 'glitch':
        return new THREE.ShaderMaterial({
          vertexShader: morphingVertexShader,
          fragmentShader: hologramFragmentShader,
          uniforms: {
            ...commonUniforms,
            opacity: { value: content.materialOpacity },
            baseColor: { value: color },
            rimColor: { value: new THREE.Color(0, 1, 0) },
            scanSpeed: { value: 5 },
            scanCount: { value: 50 },
            glitchIntensity: { value: 0.8 },
          },
          transparent: true,
          side: THREE.DoubleSide,
        });

      case 'normal':
        return new THREE.ShaderMaterial({
          vertexShader: morphingVertexShader,
          fragmentShader: `
            varying vec3 vNormal;
            uniform float opacity;
            void main() {
              vec3 normal = normalize(vNormal);
              gl_FragColor = vec4(normal * 0.5 + 0.5, opacity);
            }
          `,
          uniforms: {
            ...commonUniforms,
            opacity: { value: content.materialOpacity },
          },
          transparent: content.materialOpacity < 1,
          side: THREE.DoubleSide,
        });

      case 'depth':
        return new THREE.ShaderMaterial({
          vertexShader: morphingVertexShader,
          fragmentShader: `
            varying vec3 vPosition;
            uniform float opacity;
            void main() {
              float depth = 1.0 - (length(vPosition) / 5.0);
              gl_FragColor = vec4(vec3(depth), opacity);
            }
          `,
          uniforms: {
            ...commonUniforms,
            opacity: { value: content.materialOpacity },
          },
          transparent: content.materialOpacity < 1,
          side: THREE.DoubleSide,
        });

      default:
        return new THREE.ShaderMaterial({
          vertexShader: morphingVertexShader,
          fragmentShader: standardFragmentShader,
          uniforms: {
            ...commonUniforms,
            baseColor: { value: color },
            opacity: { value: content.materialOpacity },
            roughness: { value: 0.5 },
            metalness: { value: 0 },
            emissiveColor: { value: new THREE.Color(0, 0, 0) },
            emissiveIntensity: { value: 0 },
          },
          transparent: content.materialOpacity < 1,
          side: THREE.DoubleSide,
        });
    }
  }

  // Apply material to model
  // Cached material state to avoid recreating ShaderMaterials every frame
  // (was the #1 performance killer: creating + cloning + disposing materials
  // 60× per second triggers GPU shader recompilation on every frame).
  private _cachedMaterialKey: string = '';
  private _cachedMaterial: THREE.Material | null = null;

  private materialList(material: THREE.Material | THREE.Material[] | undefined): THREE.Material[] {
    if (!material) return [];
    return Array.isArray(material) ? material : [material];
  }

  private disposeOwnedMeshMaterials(root: THREE.Object3D) {
    root.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        this.materialList(child.material).forEach((material) => material.dispose());
      }
    });
  }

  private clearWireframeOverlays() {
    for (const { overlay } of this._wireframeMeshes) {
      overlay.removeFromParent();
      overlay.geometry.dispose();
      this.materialList(overlay.material).forEach((material) => material.dispose());
    }
    this._wireframeMeshes = [];
    this._wireframeCacheKey = null;
  }

  private clearVertexDecorations() {
    for (const markers of this._vertexDecorationMeshes) {
      markers.removeFromParent();
      markers.geometry.dispose();
      this.materialList(markers.material).forEach((material) => material.dispose());
    }
    this._vertexDecorationMeshes = [];
    this._vertexDecorationMaterials = [];
    this._vertexDecoCacheKey = null;
  }

  private clearEchoInstances() {
    for (const echo of this.echoInstances) {
      this.scene.remove(echo);
      // Echoes share immutable geometry with the source model. They own only
      // their cloned materials, so disposing the full object would corrupt
      // the source model and turn later renders black.
      this.disposeOwnedMeshMaterials(echo);
    }
    this.echoInstances = [];
    this._echoMeshPairs = [];
    this._echoCacheKey = null;
  }

  private disposeGeneratedMeshMaterial(mesh: THREE.Mesh) {
    const sourceMaterials = new Set(this.materialList(mesh.userData.sourceMaterial));
    for (const material of this.materialList(mesh.material)) {
      if (!sourceMaterials.has(material)) material.dispose();
    }
  }

  private applySourceMaterialOpacity(mesh: THREE.Mesh, opacity: number) {
    for (const material of this.materialList(mesh.material)) {
      const shouldBeTransparent = opacity < 1;
      if (material.transparent !== shouldBeTransparent) {
        material.transparent = shouldBeTransparent;
        material.needsUpdate = true;
      }
      material.opacity = opacity;
    }
  }

  private installSourceMaterialMorph(material: THREE.Material): SourceMorphUniforms {
    const existing = material.userData.ghostArcadeMorphUniforms as SourceMorphUniforms | undefined;
    if (existing) return existing;

    const uniforms: SourceMorphUniforms = {
      time: { value: 0 },
      morphIntensity: { value: 0 },
      morphType: { value: 0 },
      morphSpeed: { value: 1 },
      morphScale: { value: 1 },
      morphPhase: { value: 0 },
      morphCenter: { value: new THREE.Vector3() },
      morphReferenceSize: { value: getModel3DMorphReferenceSize(this.modelSize) },
      audioLevel: { value: 0 },
      audioMorphResponse: { value: 0 },
      morphSpread: { value: 1 },
    };
    const previousOnBeforeCompile = material.onBeforeCompile.bind(material);
    const previousProgramCacheKey = material.customProgramCacheKey.bind(material);

    material.userData.ghostArcadeMorphUniforms = uniforms;
    material.onBeforeCompile = (shader, renderer) => {
      previousOnBeforeCompile(shader, renderer);
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = injectModel3DSourceMorphVertexShader(shader.vertexShader);
    };
    material.customProgramCacheKey = () => `${previousProgramCacheKey()}|ghost-arcade-source-morph-v3`;
    material.needsUpdate = true;
    return uniforms;
  }

  private updateMorphUniformValues(
    uniforms: SourceMorphUniforms,
    content: Model3DContent,
    time: number,
    audioLevel: number,
    beatIntensity: number,
  ) {
    let intensity = content.deformationIntensity;
    if (content.beatExplode > 0 && beatIntensity > 0) {
      intensity += content.beatExplode * beatIntensity * 0.5;
    }
    uniforms.time.value = time;
    uniforms.morphIntensity.value = intensity;
    uniforms.morphType.value = this.getMorphTypeIndex(content.deformationType);
    uniforms.morphSpeed.value = content.deformationSpeed;
    uniforms.morphScale.value = content.deformationScale;
    uniforms.morphSpread.value = content.deformationSpread ?? 1;
    uniforms.morphReferenceSize.value = getModel3DMorphReferenceSize(this.modelSize);
    uniforms.audioLevel.value = audioLevel;
    uniforms.audioMorphResponse.value = content.audio.deformResponse;
  }

  private applyMaterial(content: Model3DContent, time: number, audioLevel: number = 0) {
    if (!this.model) return;

    if (content.materialType === 'source') {
      if (this._cachedMaterialKey !== 'source') {
        this._cachedMaterialKey = 'source';
        if (this._cachedMaterial) {
          this._cachedMaterial.dispose();
          this._cachedMaterial = null;
        }
        this.model.traverse((child) => {
          if (
            !(child instanceof THREE.Mesh)
            || child.userData.modelWireframeOverlay
            || child.userData.modelVertexDecoration
          ) return;
          const sourceMaterial = child.userData.sourceMaterial as THREE.Material | THREE.Material[] | undefined;
          if (!sourceMaterial) return;
          this.disposeGeneratedMeshMaterial(child);
          child.material = sourceMaterial;
          for (const material of this.materialList(sourceMaterial)) {
            this.installSourceMaterialMorph(material);
          }
        });
      }
      this.model.traverse((child) => {
        if (
          !(child instanceof THREE.Mesh)
          || child.userData.modelWireframeOverlay
          || child.userData.modelVertexDecoration
        ) return;
        for (const material of this.materialList(child.material)) {
          this.installSourceMaterialMorph(material);
        }
        this.applySourceMaterialOpacity(child, content.materialOpacity);
      });
      return;
    }

    // Build a key from STRUCTURAL properties only — those that require a different
    // shader program or Three.js material config. Numeric/color values (color,
    // roughness, metalness, emissive, opacity value) are updated live as uniforms
    // in updateShaderUniforms() to avoid rebuilding the material every frame.
    // The opacity<1 flag affects `transparent`/blending which cannot be changed
    // safely at runtime, so it triggers a rebuild on toggle.
    const matKey = `${content.materialType}|${content.materialOpacity < 1 ? 1 : 0}`;

    if (matKey !== this._cachedMaterialKey) {
      this._cachedMaterialKey = matKey;
      // Dispose old cached material
      if (this._cachedMaterial) this._cachedMaterial.dispose();
      this._cachedMaterial = this.createMaterial(content, time);

      // Apply to all meshes (only when material type changes)
      this.model.traverse((child) => {
        if (
          child instanceof THREE.Mesh
          && !child.userData.modelWireframeOverlay
          && !child.userData.modelVertexDecoration
        ) {
          this.disposeGeneratedMeshMaterial(child);
          child.material = this._cachedMaterial!.clone();
        }
      });
    }

    // Update audio level uniform on existing materials (cheap, no recompile)
    if (this._cachedMaterial instanceof THREE.ShaderMaterial && this._cachedMaterial.uniforms.audioLevel) {
      this.model.traverse((child) => {
        if (
          child instanceof THREE.Mesh
          && !child.userData.modelWireframeOverlay
          && !child.userData.modelVertexDecoration
          && child.material instanceof THREE.ShaderMaterial
          && child.material.uniforms.audioLevel
        ) {
          child.material.uniforms.audioLevel.value = audioLevel;
        }
      });
    }
  }

  // Update shader uniforms (with beat reactivity)
  private updateShaderUniforms(content: Model3DContent, time: number, audioLevel: number = 0, beatIntensity: number = 0, beatPhase: number = 0) {
    if (!this.model) return;
    const lightingProfile = getModel3DLightingProfile(content.lightingPreset);

    this.model.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;

      for (const material of this.materialList(child.material)) {
        const sourceMorphUniforms = material.userData.ghostArcadeMorphUniforms as SourceMorphUniforms | undefined;
        if (sourceMorphUniforms) {
          this.updateMorphUniformValues(sourceMorphUniforms, content, time, audioLevel, beatIntensity);
        }
      }

      if (child.material instanceof THREE.ShaderMaterial) {
        const uniforms = child.material.uniforms;
        if (uniforms.time) uniforms.time.value = time;
        if (uniforms.morphIntensity) {
          // Boost deformation on beats
          let morphInt = content.deformationIntensity;
          if (content.beatExplode > 0 && beatIntensity > 0) {
            morphInt += content.beatExplode * beatIntensity * 0.5;
          }
          uniforms.morphIntensity.value = morphInt;
        }
        if (uniforms.morphType) uniforms.morphType.value = this.getMorphTypeIndex(content.deformationType);
        if (uniforms.morphSpeed) uniforms.morphSpeed.value = content.deformationSpeed;
        if (uniforms.morphScale) uniforms.morphScale.value = content.deformationScale;
        if (uniforms.morphSpread) uniforms.morphSpread.value = content.deformationSpread ?? 1;
        if (uniforms.morphReferenceSize) {
          uniforms.morphReferenceSize.value = getModel3DMorphReferenceSize(this.modelSize);
        }
        if (uniforms.audioLevel) uniforms.audioLevel.value = audioLevel;
        // Live lighting (panel sliders + preset → shader). Without this the
        // Lighting controls do nothing because the morph shader can't sample
        // the scene's THREE.Light objects.
        if (uniforms.ambientIntensity) {
          uniforms.ambientIntensity.value =
            (content.ambientIntensity ?? 0.4) * lightingProfile.ambientScale;
        }
        if (uniforms.directionalIntensity) {
          uniforms.directionalIntensity.value =
            (content.directionalIntensity ?? 1.0) * lightingProfile.keyScale;
        }
        if (uniforms.shadowsEnabled) {
          uniforms.shadowsEnabled.value = (content.shadowsEnabled ?? true) ? 1 : 0;
        }
        if (uniforms.shadowStrength) {
          uniforms.shadowStrength.value = lightingProfile.selfShadowStrength;
        }
        if (uniforms.shadowSoftness) {
          uniforms.shadowSoftness.value = content.shadowSoftness ?? 1;
        }
        if (uniforms.lightDir) {
          uniforms.lightDir.value.copy(this.getLightDirForPreset(
            content.lightingPreset,
            content.keyLightAzimuth ?? 45,
            content.keyLightElevation ?? 50,
          ));
        }
        if (uniforms.lightColor) uniforms.lightColor.value.copy(this.getLightColorForPreset(content.lightingPreset, content.lightColor, time));
        if (uniforms.dissolveAmount) uniforms.dissolveAmount.value = content.dissolveAmount;

        // ── Live material uniform updates (color, opacity, PBR, emissive) ──
        // These update every frame so slider changes take effect without
        // rebuilding the material. Each uniform is guarded so materials that
        // don't declare it are skipped.
        if (uniforms.baseColor && content.materialColor) {
          uniforms.baseColor.value.setRGB(
            content.materialColor[0] / 255,
            content.materialColor[1] / 255,
            content.materialColor[2] / 255
          );
        }
        if (uniforms.opacity) uniforms.opacity.value = content.materialOpacity;
        if (uniforms.roughness) uniforms.roughness.value = content.materialRoughness;
        if (uniforms.metalness) uniforms.metalness.value = content.materialMetalness;
        if (uniforms.tintColor && content.materialColor) {
          uniforms.tintColor.value.setRGB(
            content.materialColor[0] / 255,
            content.materialColor[1] / 255,
            content.materialColor[2] / 255
          );
        }
        if (uniforms.emissiveColor && content.materialEmissive) {
          uniforms.emissiveColor.value.setRGB(
            content.materialEmissive[0] / 255,
            content.materialEmissive[1] / 255,
            content.materialEmissive[2] / 255
          );
        }
        if (uniforms.emissiveIntensity) {
          // Base value + optional beat flash boost
          let intensity = content.materialEmissiveIntensity;
          if (content.beatColorFlash > 0 && beatIntensity > 0) {
            intensity += content.beatColorFlash * beatIntensity * 3;
          }
          uniforms.emissiveIntensity.value = intensity;
        }
        // Neon uses glowIntensity (mapped from materialEmissiveIntensity)
        if (uniforms.glowIntensity) uniforms.glowIntensity.value = content.materialEmissiveIntensity;
        if (uniforms.pulseSpeed) uniforms.pulseSpeed.value = content.animationSpeed;

        // Material-specific controls must update the live shader instances as
        // well as the cached template. Rebuilding a material for every slider
        // event is both expensive and prone to leaving cloned mesh materials
        // with their creation-time defaults.
        if (uniforms.fresnelColor && content.fresnelColor) {
          uniforms.fresnelColor.value.setRGB(
            content.fresnelColor[0] / 255,
            content.fresnelColor[1] / 255,
            content.fresnelColor[2] / 255
          );
        }
        if (uniforms.fresnelPower) uniforms.fresnelPower.value = content.fresnelPower;
        if (uniforms.rimColor && content.materialType === 'hologram') {
          uniforms.rimColor.value.setRGB(
            content.hologramRimColor[0] / 255,
            content.hologramRimColor[1] / 255,
            content.hologramRimColor[2] / 255
          );
        }
        if (uniforms.scanSpeed && content.materialType === 'hologram') {
          uniforms.scanSpeed.value = content.hologramScanSpeed;
        }
        if (uniforms.scanCount && content.materialType === 'hologram') {
          uniforms.scanCount.value = content.hologramScanCount;
        }
        if (uniforms.glitchIntensity && content.materialType === 'hologram') {
          uniforms.glitchIntensity.value = content.hologramGlitchIntensity;
        }
        if (uniforms.glowColor && content.lavaGlowColor) {
          uniforms.glowColor.value.setRGB(
            content.lavaGlowColor[0] / 255,
            content.lavaGlowColor[1] / 255,
            content.lavaGlowColor[2] / 255
          );
        }
        if (uniforms.flowSpeed) uniforms.flowSpeed.value = content.lavaFlowSpeed;
        if (uniforms.crackIntensity) uniforms.crackIntensity.value = content.lavaCrackIntensity;
        if (uniforms.thickness) uniforms.thickness.value = content.glassThickness;
        if (uniforms.ior) uniforms.ior.value = content.glassIOR;
        if (uniforms.reflectivity) uniforms.reflectivity.value = content.chromeReflectivity;
        if (uniforms.refraction) uniforms.refraction.value = content.iceRefraction;
        if (uniforms.frostiness) uniforms.frostiness.value = content.iceFrostIntensity;
        if (uniforms.edgeColor && content.dissolveEdgeColor) {
          uniforms.edgeColor.value.setRGB(
            content.dissolveEdgeColor[0] / 255,
            content.dissolveEdgeColor[1] / 255,
            content.dissolveEdgeColor[2] / 255
          );
        }
        if (uniforms.edgeWidth) uniforms.edgeWidth.value = content.dissolveEdgeWidth;
      }
    });
  }

  // Create wireframe overlay
  private updateWireframe(content: Model3DContent, time: number) {
    if (!this.model) return;

    if (content.wireframeMode === 'none') {
      this.clearWireframeOverlays();
      return;
    }

    // Three's built-in wireframe flag uses fixed one-pixel GL lines on modern
    // WebGL/Metal implementations. Barycentric coordinates give us a real
    // screen-space thickness control while retaining each source mesh's exact
    // hierarchy and deformation.
    const cacheKey = `${this.model.uuid}|${content.wireframeMode}|${this._cachedMaterialKey}`;
    if (this._wireframeCacheKey !== cacheKey) {
      this.clearWireframeOverlays();
      const sourceMeshes: THREE.Mesh[] = [];
      this.model.traverse((child) => {
        if (
          child instanceof THREE.Mesh
          && !child.userData.modelWireframeOverlay
          && !child.userData.modelVertexDecoration
        ) {
          sourceMeshes.push(child);
        }
      });
      for (const source of sourceMeshes) {
        const material = new THREE.ShaderMaterial({
          vertexShader: wireframeVertexShader,
          fragmentShader: wireframeFragmentShader,
          uniforms: {
            time: { value: time },
            morphIntensity: { value: content.deformationIntensity },
            morphType: { value: this.getMorphTypeIndex(content.deformationType) },
            morphSpeed: { value: content.deformationSpeed },
            morphScale: { value: content.deformationScale },
            morphSpread: { value: content.deformationSpread ?? 1 },
            morphPhase: { value: 0 },
            morphCenter: { value: new THREE.Vector3() },
            morphReferenceSize: { value: getModel3DMorphReferenceSize(this.modelSize) },
            audioLevel: { value: 0 },
            audioMorphResponse: { value: content.audio.deformResponse },
            wireMode: { value: getModel3DWireframeModeIndex(content.wireframeMode) },
            wireColor: { value: new THREE.Color() },
            wireOpacity: { value: content.wireframeOpacity },
            wireThickness: { value: content.wireframeThickness },
            wireAnimSpeed: { value: content.wireframeAnimSpeed },
          },
          transparent: true,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
          side: THREE.DoubleSide,
        });
        const overlay = new THREE.Mesh(
          createModel3DWireframeGeometry(source.geometry),
          material,
        );
        overlay.name = 'GhostArcadeModelWireframeOverlay';
        overlay.userData.modelWireframeOverlay = true;
        overlay.renderOrder = source.renderOrder + 1;
        overlay.frustumCulled = source.frustumCulled;
        source.add(overlay);
        this._wireframeMeshes.push({ overlay, src: source });
      }
      this._wireframeCacheKey = cacheKey;
    }

    const baseR = content.wireframeColor[0] / 255;
    const baseG = content.wireframeColor[1] / 255;
    const baseB = content.wireframeColor[2] / 255;
    const wireColor = new THREE.Color(baseR, baseG, baseB);

    for (const { overlay } of this._wireframeMeshes) {
      const material = overlay.material as THREE.ShaderMaterial;
      material.uniforms.time.value = time;
      material.uniforms.wireMode.value = getModel3DWireframeModeIndex(content.wireframeMode);
      material.uniforms.wireColor.value.copy(wireColor);
      material.uniforms.wireOpacity.value = content.wireframeOpacity;
      material.uniforms.wireThickness.value = content.wireframeThickness;
      material.uniforms.wireAnimSpeed.value = content.wireframeAnimSpeed;
      material.blending =
        content.wireframeMode === 'glow' || content.wireframeMode === 'neon'
          ? THREE.AdditiveBlending
          : THREE.NormalBlending;
    }
  }

  // Create vertex decorations. Markers are attached to each source mesh and
  // evaluate the same GPU morph as that mesh, so they remain registered while
  // the model deforms instead of preserving a stale import-time snapshot.
  private updateVertexDecorations(
    content: Model3DContent,
    time: number,
    audioLevel: number,
    beatIntensity: number,
  ) {
    if (!this.model) return;

    if (content.vertexDecoration === 'none') {
      this.clearVertexDecorations();
      return;
    }

    // Rebuild only when shape OR size OR model identity changes.
    const cacheKey = `${this.model.uuid}|${content.vertexDecoration}|${content.vertexDecorationSize}`;
    if (this._vertexDecoCacheKey !== cacheKey) {
      this.clearVertexDecorations();

      // The model is normalized to two scene units after import. Build marker
      // geometry in source-local scale so the panel's Size value remains a
      // stable scene-space measurement for tiny and huge assets alike.
      const size = Math.max(
        0.0001,
        content.vertexDecorationSize * getModel3DMorphReferenceSize(this.modelSize) * 0.5,
      );
      let decoGeometry: THREE.BufferGeometry;
      switch (content.vertexDecoration) {
        case 'spheres':  decoGeometry = new THREE.SphereGeometry(size, 8, 6); break;
        case 'cubes':    decoGeometry = new THREE.BoxGeometry(size, size, size); break;
        case 'pyramids': decoGeometry = new THREE.TetrahedronGeometry(size); break;
        case 'diamonds': decoGeometry = new THREE.OctahedronGeometry(size); break;
        default:         decoGeometry = new THREE.SphereGeometry(size * 0.5, 4, 4);
      }

      const sourceMeshes: THREE.Mesh[] = [];
      let totalVertices = 0;
      this.model.traverse((child) => {
        if (
          child instanceof THREE.Mesh
          && !child.userData.modelWireframeOverlay
          && !child.userData.modelVertexDecoration
        ) {
          sourceMeshes.push(child);
          totalVertices += child.geometry.getAttribute('position')?.count ?? 0;
        }
      });

      // One InstancedMesh keeps a scanned model to a single marker draw call.
      const maxDecorations = 800;
      const sampleStep = Math.max(1, Math.ceil(totalVertices / maxDecorations));
      let visitedVertices = 0;
      let createdDecorations = 0;
      for (const source of sourceMeshes) {
        const positions = source.geometry.getAttribute('position');
        if (!positions) continue;
        const normals = source.geometry.getAttribute('normal');
        const markerPositions: number[] = [];
        const markerNormals: number[] = [];

        for (
          let index = 0;
          index < positions.count && createdDecorations < maxDecorations;
          index++
        ) {
          if (visitedVertices++ % sampleStep !== 0) continue;
          markerPositions.push(
            positions.getX(index),
            positions.getY(index),
            positions.getZ(index),
          );
          markerNormals.push(
            normals?.getX(index) ?? 0,
            normals?.getY(index) ?? 1,
            normals?.getZ(index) ?? 0,
          );
          createdDecorations++;
        }
        if (markerPositions.length === 0) continue;

        const markerGeometry = decoGeometry.clone();
        markerGeometry.setAttribute(
          'markerRestPosition',
          new THREE.InstancedBufferAttribute(new Float32Array(markerPositions), 3),
        );
        markerGeometry.setAttribute(
          'markerRestNormal',
          new THREE.InstancedBufferAttribute(new Float32Array(markerNormals), 3),
        );
        const markerMaterial = new THREE.ShaderMaterial({
          vertexShader: vertexDecorationVertexShader,
          fragmentShader: vertexDecorationFragmentShader,
          uniforms: {
            time: { value: time },
            morphIntensity: { value: content.deformationIntensity },
            morphType: { value: this.getMorphTypeIndex(content.deformationType) },
            morphSpeed: { value: content.deformationSpeed },
            morphScale: { value: content.deformationScale },
            morphSpread: { value: content.deformationSpread ?? 1 },
            morphPhase: { value: 0 },
            morphCenter: { value: new THREE.Vector3() },
            morphReferenceSize: { value: getModel3DMorphReferenceSize(this.modelSize) },
            audioLevel: { value: audioLevel },
            audioMorphResponse: { value: content.audio.deformResponse },
            markerColor: { value: new THREE.Color() },
            markerOpacity: { value: 0.8 },
          },
          transparent: true,
          depthWrite: false,
        });
        const markerCount = markerPositions.length / 3;
        const markers = new THREE.InstancedMesh(
          markerGeometry,
          markerMaterial,
          markerCount,
        );
        markers.name = 'GhostArcadeModelVertexMarkers';
        markers.userData.modelVertexDecoration = true;
        markers.frustumCulled = false;

        // The custom shader uses markerRestPosition for placement. Identity
        // matrices keep Three's instancing state valid without duplicating the
        // sampled position in an instance transform.
        const identity = new THREE.Matrix4();
        for (let index = 0; index < markerCount; index++) {
          markers.setMatrixAt(index, identity);
        }
        markers.instanceMatrix.needsUpdate = true;
        source.add(markers);
        this._vertexDecorationMeshes.push(markers);
        this._vertexDecorationMaterials.push(markerMaterial);
      }

      decoGeometry.dispose();
      this._vertexDecoCacheKey = cacheKey;
    }

    for (const markerMaterial of this._vertexDecorationMaterials) {
      this.updateMorphUniformValues(
        markerMaterial.uniforms as unknown as SourceMorphUniforms,
        content,
        time,
        audioLevel,
        beatIntensity,
      );
      (markerMaterial.uniforms.markerColor.value as THREE.Color).setRGB(
        content.vertexDecorationColor[0] / 255,
        content.vertexDecorationColor[1] / 255,
        content.vertexDecorationColor[2] / 255,
      );
    }
  }

  private echoTargetCount(requestedCount: number) {
    const requested = THREE.MathUtils.clamp(Math.floor(requestedCount), 0, 24);
    if (requested === 0) return 0;

    // Echo geometry is shared, but every copy still submits its meshes and
    // triangles. Bound both costs so a scanned asset cannot generate hundreds
    // of millions of fragments or draw calls in one click.
    const triangleBudget = 2_000_000;
    const drawCallBudget = 160;
    const byTriangles = this.modelTriangleCount > 0
      ? Math.max(1, Math.floor(triangleBudget / this.modelTriangleCount))
      : requested;
    const byDrawCalls = this.modelMeshCount > 0
      ? Math.max(1, Math.floor(drawCallBudget / this.modelMeshCount))
      : requested;
    return Math.min(requested, byTriangles, byDrawCalls);
  }

  private createEchoInstance(instanceIndex: number) {
    if (!this.model) return null;

    const sourceMeshes: THREE.Mesh[] = [];
    this.model.traverse((child) => {
      if (
        child instanceof THREE.Mesh
        && !child.userData.modelWireframeOverlay
        && !child.userData.modelVertexDecoration
      ) {
        sourceMeshes.push(child);
      }
    });

    const echo = this.model.clone(true);
    echo.name = 'GhostArcadeModelEcho';
    echo.userData.modelEcho = true;

    // Presentation helpers are rebuilt from the live source. Never clone them
    // into an echo or they become additional source meshes with stale state.
    const clonedOverlays: THREE.Mesh[] = [];
    echo.traverse((child) => {
      if (
        child instanceof THREE.Mesh
        && (child.userData.modelWireframeOverlay || child.userData.modelVertexDecoration)
      ) {
        clonedOverlays.push(child);
      }
    });
    clonedOverlays.forEach((overlay) => overlay.removeFromParent());

    const echoMeshes: THREE.Mesh[] = [];
    echo.traverse((child) => {
      if (
        child instanceof THREE.Mesh
        && !child.userData.modelWireframeOverlay
        && !child.userData.modelVertexDecoration
      ) {
        echoMeshes.push(child);
      }
    });

    const pairs: { sourceMesh: THREE.Mesh; echoMesh: THREE.Mesh }[] = [];
    for (let index = 0; index < echoMeshes.length; index++) {
      const echoMesh = echoMeshes[index];
      const sourceMesh = sourceMeshes[index];
      const clonedMaterials = this.materialList(echoMesh.material).map((material) => {
        const clone = material.clone();
        clone.transparent = true;
        clone.depthWrite = false;
        // Echoes are a presentation pass. Leaving depth testing enabled makes
        // copies behind an opaque source mesh disappear completely.
        clone.depthTest = false;
        return clone;
      });
      echoMesh.material = Array.isArray(echoMesh.material)
        ? clonedMaterials
        : clonedMaterials[0];
      echoMesh.renderOrder = 20 + instanceIndex;
      if (sourceMesh) pairs.push({ sourceMesh, echoMesh });
    }

    this.scene.add(echo);
    return { echo, pairs };
  }

  // Create echo/trail instances
  private updateEchoInstances(content: Model3DContent, time: number) {
    if (!this.model || !content.echo.enabled || content.echo.type === 'none') {
      this.clearEchoInstances();
      return;
    }

    const count = this.echoTargetCount(content.echo.count);
    if (count === 0) {
      this.clearEchoInstances();
      return;
    }

    // Count changes do not invalidate existing echoes. Structural material
    // changes do, because each echo owns a compatible clone of that material.
    const cacheKey = `${this.model.uuid}|${content.materialType}|${content.materialOpacity < 1 ? 1 : 0}`;
    if (this._echoCacheKey !== cacheKey) {
      this.clearEchoInstances();
      this._echoCacheKey = cacheKey;
    }

    while (this.echoInstances.length > count) {
      const echo = this.echoInstances.pop();
      this._echoMeshPairs.pop();
      if (echo) {
        this.scene.remove(echo);
        this.disposeOwnedMeshMaterials(echo);
      }
    }

    // Add at most one deep hierarchy clone per rendered frame. Echoes become
    // visible immediately, while complex models ramp to the requested count
    // without freezing the UI.
    if (this.echoInstances.length < count) {
      const instance = this.createEchoInstance(this.echoInstances.length);
      if (instance) {
        this.echoInstances.push(instance.echo);
        this._echoMeshPairs.push(instance.pairs);
      }
    }

    for (let i = 1; i <= this.echoInstances.length; i++) {
      const echo = this.echoInstances[i - 1];
      const t = i / count;
      const opacity = THREE.MathUtils.clamp(
        content.materialOpacity * (1 - t * THREE.MathUtils.clamp(content.echo.fadeRate, 0, 1)),
        0.08,
        0.95,
      );

      // Note: scale and rotation variation are deterministic per-index now
      // (was Math.random() per frame, which jittered echoes every frame anyway).
      const seed = i * 0.1373;
      const scaleVar = 1 + ((seed % 1) - 0.5) * content.echo.scaleVariation * 0.5;
      const rotVar = (((seed * 7.31) % 1) - 0.5) * content.echo.rotationVariation * Math.PI * 0.5;
      const phase = t * content.echo.phaseOffset * Math.PI * 2;
      const cycle = time * content.echo.speed;
      const hash = (salt: number) => {
        const value = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
        return value - Math.floor(value);
      };

      let offset = new THREE.Vector3();

      switch (content.echo.type) {
        case 'ghostTrail':
          offset.set(
            -i * content.echo.spacing * 0.12,
            Math.sin(i * 0.7) * content.echo.spacing * 0.18,
            -i * content.echo.spacing * 0.35,
          );
          break;

        case 'motionBlur':
          offset.set(
            -i * content.echo.spacing * 0.22,
            0,
            i * content.echo.spacing * 0.05,
          );
          break;

        case 'afterimage':
          offset.set(
            Math.sin(phase + i) * content.echo.spacing * 0.25,
            Math.cos(phase * 0.7 + i) * content.echo.spacing * 0.2,
            -i * content.echo.spacing * 0.08,
          );
          break;

        case 'strobeCopies': {
          const step = Math.floor(cycle * 4) * 0.35;
          offset.set(
            Math.sin(step + i * 1.7) * content.echo.spacing,
            Math.cos(step * 0.8 + i) * content.echo.spacing * 0.55,
            Math.sin(step * 0.5 + i * 2.1) * content.echo.spacing * 0.35,
          );
          break;
        }

        case 'stream':
          offset.set(
            Math.sin(cycle + phase) * content.echo.spacing * 0.3,
            i * content.echo.spacing * 0.2,
            -i * content.echo.spacing * 0.4
          );
          break;

        case 'swarm':
          offset.set(
            Math.sin(cycle * 0.7 + hash(1) * Math.PI * 2) * content.echo.spacing * (0.4 + hash(2)),
            Math.cos(cycle * 0.9 + hash(3) * Math.PI * 2) * content.echo.spacing * (0.3 + hash(4)),
            Math.sin(cycle * 0.5 + hash(5) * Math.PI * 2) * content.echo.spacing * (0.4 + hash(6)),
          );
          break;

        case 'radial': {
          const angle = (i / count) * Math.PI * 2;
          offset.set(
            Math.cos(angle) * content.echo.spacing,
            0,
            Math.sin(angle) * content.echo.spacing
          );
          break;
        }

        case 'spiral': {
          const spiralAngle = (i / count) * Math.PI * 4 + time * content.echo.speed * 0.5;
          const spiralRadius = i * content.echo.spacing * 0.3;
          offset.set(
            Math.cos(spiralAngle) * spiralRadius,
            i * content.echo.spacing * 0.15,
            Math.sin(spiralAngle) * spiralRadius
          );
          break;
        }

        case 'grid': {
          const gridSize = Math.ceil(Math.cbrt(count));
          const gridIndex = i - 1;
          const gx = gridIndex % gridSize;
          const gy = Math.floor(gridIndex / gridSize) % gridSize;
          const gz = Math.floor(gridIndex / (gridSize * gridSize));
          offset.set(
            (gx - (gridSize - 1) / 2) * content.echo.spacing * 0.65,
            (gy - (gridSize - 1) / 2) * content.echo.spacing * 0.65,
            (gz - (gridSize - 1) / 2) * content.echo.spacing * 0.65
          );
          break;
        }

        case 'random':
          offset.set(
            (hash(1) * 2 - 1) * content.echo.spacing * 1.5,
            (hash(2) * 2 - 1) * content.echo.spacing * 1.5,
            (hash(3) * 2 - 1) * content.echo.spacing,
          );
          break;

        case 'fountain': {
          const fountainPhase = (cycle * 0.35 + t) % 1;
          const fountainArc = 4 * fountainPhase * (1 - fountainPhase);
          offset.set(
            (hash(1) * 2 - 1) * content.echo.spacing * fountainPhase,
            content.echo.spacing * (fountainArc * 1.8 - fountainPhase * 0.5),
            (hash(2) * 2 - 1) * content.echo.spacing * fountainPhase,
          );
          break;
        }

        case 'orbit': {
          const orbitAngle = (i / count) * Math.PI * 2 + time * content.echo.speed * 0.3;
          offset.set(
            Math.cos(orbitAngle) * content.echo.spacing,
            Math.sin(orbitAngle * 0.5) * content.echo.spacing * 0.5,
            Math.sin(orbitAngle) * content.echo.spacing
          );
          break;
        }

        case 'tornado': {
          const tornadoAngle = (i / count) * Math.PI * 6 + time * content.echo.speed;
          const tornadoRadius = (1 - t) * content.echo.spacing;
          offset.set(
            Math.cos(tornadoAngle) * tornadoRadius,
            i * content.echo.spacing * 0.2,
            Math.sin(tornadoAngle) * tornadoRadius
          );
          break;
        }

        case 'explosion': {
          const burst = (cycle * 0.35) % 1;
          const theta = hash(1) * Math.PI * 2;
          const z = hash(2) * 2 - 1;
          const radius = Math.sqrt(Math.max(0, 1 - z * z));
          const distance = content.echo.spacing * (0.25 + hash(3)) * burst * 2;
          offset.set(
            Math.cos(theta) * radius * distance,
            z * distance,
            Math.sin(theta) * radius * distance,
          );
          break;
        }

        case 'matrix': {
          const fall = (cycle * 0.25 + hash(1)) % 1;
          offset.set(
            (hash(2) * 2 - 1) * content.echo.spacing * 1.5,
            content.echo.spacing * (1.5 - fall * 3),
            (hash(3) * 2 - 1) * content.echo.spacing * 0.35,
          );
          break;
        }

        case 'dna': {
          const dnaAngle = (i / count) * Math.PI * 4;
          const strand = i % 2;
          offset.set(
            Math.cos(dnaAngle + strand * Math.PI) * content.echo.spacing * 0.5,
            i * content.echo.spacing * 0.2,
            Math.sin(dnaAngle + strand * Math.PI) * content.echo.spacing * 0.5
          );
          break;
        }

        case 'kaleidoscope': {
          const kSegments = 6;
          const kAngle = (i % kSegments) / kSegments * Math.PI * 2;
          const kRadius = Math.floor(i / kSegments) * content.echo.spacing * 0.5 + 0.5;
          offset.set(
            Math.cos(kAngle) * kRadius,
            0,
            Math.sin(kAngle) * kRadius
          );
          break;
        }

        default:
          offset.x = -i * content.echo.spacing * 0.2;
      }

      echo.position.copy(this.model.position).add(offset);
      echo.scale.copy(this.model.scale).multiplyScalar(scaleVar);
      echo.rotation.copy(this.model.rotation);
      echo.rotation.y += rotVar;

      // Sync live uniforms (deformation, color, audio, time, etc.) from each
      // source mesh's material onto this echo's cloned material — preserving
      // per-echo opacity. This is what makes deformation/material edits visible
      // on echoes without having to toggle echo off/on.
      const pairs = this._echoMeshPairs[i - 1];
      if (pairs) {
        for (const { sourceMesh, echoMesh } of pairs) {
          const sourceMaterials = this.materialList(sourceMesh.material);
          const echoMaterials = this.materialList(echoMesh.material);
          for (let materialIndex = 0; materialIndex < echoMaterials.length; materialIndex++) {
            const sm = sourceMaterials[Math.min(materialIndex, sourceMaterials.length - 1)];
            const em = echoMaterials[materialIndex];
            if (sm instanceof THREE.ShaderMaterial && em instanceof THREE.ShaderMaterial) {
              for (const k in sm.uniforms) {
                if (k === 'opacity') continue;
                const su = sm.uniforms[k];
                const eu = em.uniforms[k];
                if (!eu || su.value === undefined) continue;
                const v: any = su.value;
                if (v && typeof v === 'object') {
                  if (typeof v.copy === 'function' && typeof eu.value?.copy === 'function') {
                    eu.value.copy(v);
                  } else {
                    eu.value = v;
                  }
                } else {
                  eu.value = v;
                }
              }
              if (em.uniforms.opacity) em.uniforms.opacity.value = opacity;
            }
            em.opacity = opacity;
            em.transparent = true;
            em.depthTest = false;
            em.depthWrite = false;
          }
        }
      }
    }
  }

  // Update camera
  private updateCamera(content: Model3DContent, time: number) {
    const camera = content.camera;

    this.camera.fov = camera.fov;
    this.camera.updateProjectionMatrix();

    const orbitY = camera.orbitY * Math.PI / 180;
    const orbitX = THREE.MathUtils.clamp(camera.orbitX, -89, 89) * Math.PI / 180;
    const distance = Math.max(0.25, camera.distance);

    this.camera.position.x = Math.sin(orbitY) * Math.cos(orbitX) * distance + camera.panX;
    this.camera.position.y = Math.sin(orbitX) * distance + camera.panY;
    this.camera.position.z = Math.cos(orbitY) * Math.cos(orbitX) * distance;

    this.camera.lookAt(camera.panX, camera.panY, 0);
    this.camera.rotation.z = camera.roll * Math.PI / 180;
  }

  // ── Animation type dispatch ───────────────────────────────────────────────
  // The "Animation Type" dropdown in the Model3D panel sets `content.animationType`.
  // Transforms are applied *additively* on top of the user's static position/rotation/scale,
  // so audio reactivity and per-content transforms still compose correctly.

  private applyAnimationTransform(content: Model3DContent, time: number) {
    if (!this.model) return;
    const type = content.animationType;
    if (!type || type === 'none') return;

    const speed = content.animationSpeed ?? 1;
    const intensity = content.animationIntensity ?? 1;
    // For one-shot animations, prefer the manual progress slider when looping is off.
    const loopT = ((time * speed * 0.25) % 1 + 1) % 1;
    const oneShotT = content.animationLoop
      ? loopT
      : Math.max(0, Math.min(1, content.animationProgress ?? 0));

    switch (type) {
      case 'rotate':
        this.model.rotation.y += time * speed * 0.5;
        break;
      case 'orbit': {
        const r = intensity * 1.5;
        const a = time * speed * 0.5;
        this.model.position.x += Math.cos(a) * r;
        this.model.position.z += Math.sin(a) * r;
        break;
      }
      case 'bounce': {
        const h = Math.abs(Math.sin(time * speed * 2)) * intensity * 0.5;
        this.model.position.y += h;
        break;
      }
      case 'swing':
        this.model.rotation.z += Math.sin(time * speed * 1.5) * intensity * 0.4;
        break;
      case 'float':
        this.model.position.x += Math.sin(time * speed * 0.7) * intensity * 0.15;
        this.model.position.y += Math.sin(time * speed * 0.5 + 1.0) * intensity * 0.2;
        this.model.position.z += Math.cos(time * speed * 0.6 + 2.0) * intensity * 0.15;
        break;
      case 'shake': {
        const m = intensity * 0.05;
        this.model.position.x += (Math.sin(time * 47.3) + Math.sin(time * 31.7 + 1.2)) * 0.5 * m;
        this.model.position.y += (Math.sin(time * 53.1 + 2.1) + Math.sin(time * 29.3)) * 0.5 * m;
        this.model.position.z += (Math.sin(time * 41.9) + Math.sin(time * 37.1 + 0.7)) * 0.5 * m;
        break;
      }
      case 'spiral': {
        const a = time * speed * 0.8;
        const r = intensity * (0.5 + 0.5 * Math.sin(time * speed * 0.3));
        this.model.position.x += Math.cos(a) * r;
        this.model.position.z += Math.sin(a) * r;
        this.model.position.y += Math.sin(time * speed * 0.4) * intensity * 0.3;
        break;
      }
      case 'scaleIn':
        this.model.scale.multiplyScalar(Math.max(0.001, oneShotT));
        break;
      case 'unfold': {
        // Rotate from 90° toward 0° on X as t→1.
        const a = (1 - oneShotT) * (Math.PI * 0.5) * intensity;
        this.model.rotation.x += a;
        break;
      }
      case 'assemble': {
        // Parts approach from explosion: scale balloon + spin shrinks toward 0 as t→1.
        const f = 1 - oneShotT;
        this.model.scale.multiplyScalar(1 + f * intensity * 1.5);
        this.model.rotation.y += f * Math.PI * 2;
        break;
      }
      case 'grow': {
        // Cubic ease-out from a tiny seed.
        const eased = 1 - Math.pow(1 - oneShotT, 3);
        this.model.scale.multiplyScalar(Math.max(0.001, eased));
        break;
      }
      case 'morphLoop': {
        // Subtle squash-stretch — true vertex morphing would require keyframe state.
        const m = Math.sin(time * speed) * intensity * 0.15;
        this.model.scale.x *= 1 + m;
        this.model.scale.y *= 1 - m * 0.5;
        this.model.scale.z *= 1 + m * 0.5;
        break;
      }
      // fadeIn / colorCycle / texturePan are material-side — handled in applyAnimationMaterial.
    }
  }

  private applyAnimationMaterial(content: Model3DContent, time: number) {
    if (!this.model) return;
    const type = content.animationType;
    if (!type || type === 'none') return;

    const speed = content.animationSpeed ?? 1;
    const loopT = ((time * speed * 0.25) % 1 + 1) % 1;
    const oneShotT = content.animationLoop ? loopT : Math.max(0, Math.min(1, content.animationProgress ?? 0));

    switch (type) {
      case 'fadeIn':
        this.model.traverse((child) => {
          if (child instanceof THREE.Mesh && child.material) {
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            for (const mat of mats) {
              (mat as any).transparent = true;
              (mat as any).opacity = oneShotT;
            }
          }
        });
        break;
      case 'colorCycle': {
        const hue = ((time * speed * 0.1) % 1 + 1) % 1;
        this.model.traverse((child) => {
          if (child instanceof THREE.Mesh && child.material) {
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            for (const mat of mats) {
              if ((mat as any).color) (mat as any).color.setHSL(hue, 1, 0.5);
            }
          }
        });
        break;
      }
      case 'texturePan': {
        const u = ((time * speed * 0.1) % 1 + 1) % 1;
        const v = ((time * speed * 0.07) % 1 + 1) % 1;
        this.model.traverse((child) => {
          if (child instanceof THREE.Mesh && child.material) {
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            for (const mat of mats) {
              const map = (mat as any).map;
              if (map?.offset) map.offset.set(u, v);
            }
          }
        });
        break;
      }
    }
  }

  // Update disco lights
  private updateDiscoLights(time: number) {
    this.lights.forEach((light) => {
      if (light.userData.discoIndex !== undefined) {
        const hue = (time * 0.5 + light.userData.discoIndex * 0.17) % 1;
        (light as THREE.PointLight).color.setHSL(hue, 1, 0.5);
        const angle = time * 0.5 + light.userData.discoIndex * Math.PI / 3;
        light.position.x = Math.cos(angle) * 5;
        light.position.z = Math.sin(angle) * 5;
      }
    });
  }

  private ensureEnvironment(renderer: THREE.WebGLRenderer) {
    if (this.environmentMap && this.environmentRenderer === renderer) return;
    this.environmentMap?.dispose();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    this.environmentMap = pmrem.fromScene(room).texture;
    this.environmentRenderer = renderer;
    if (this.environmentBackdrop) {
      this.environmentBackdrop.material.envMap = this.environmentMap;
      this.environmentBackdrop.material.needsUpdate = true;
    }
    room.dispose();
    pmrem.dispose();
  }

  private ensureEnvironmentBackdrop() {
    if (this.environmentBackdrop) return this.environmentBackdrop;

    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      envMap: this.environmentMap,
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
      toneMapped: true,
    });
    // Keep the backdrop in the opaque queue so it renders before the model,
    // while custom alpha blending lets lower compositor layers show through.
    material.blending = THREE.CustomBlending;
    material.blendEquation = THREE.AddEquation;
    material.blendSrc = THREE.SrcAlphaFactor;
    material.blendDst = THREE.OneMinusSrcAlphaFactor;
    material.blendEquationAlpha = THREE.AddEquation;
    material.blendSrcAlpha = THREE.OneFactor;
    material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;

    const backdrop = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), material);
    backdrop.frustumCulled = false;
    backdrop.renderOrder = -10000;
    this.scene.add(backdrop);
    this.environmentBackdrop = backdrop;
    return backdrop;
  }

  private backgroundAlpha(content: Model3DContent) {
    if ((content.backgroundMode ?? 'transparent') === 'transparent') return 0;
    return THREE.MathUtils.clamp(content.backgroundOpacity ?? 1, 0, 1);
  }

  private applyBackgroundClear(renderer: THREE.WebGLRenderer, content: Model3DContent) {
    const color = content.backgroundMode === 'color'
      ? new THREE.Color(
        (content.backgroundColor?.[0] ?? 8) / 255,
        (content.backgroundColor?.[1] ?? 8) / 255,
        (content.backgroundColor?.[2] ?? 12) / 255,
      )
      : new THREE.Color(0x000000);
    renderer.setClearColor(color, this.backgroundAlpha(content));
  }

  private updateScenePresentation(content: Model3DContent, renderer?: THREE.WebGLRenderer | null) {
    if (renderer && (content.environmentEnabled ?? true)) {
      this.ensureEnvironment(renderer);
    }

    const environmentEnabled = content.environmentEnabled ?? true;
    const lightingProfile = getModel3DLightingProfile(content.lightingPreset);
    this.scene.environment = environmentEnabled ? this.environmentMap : null;
    (this.scene as THREE.Scene & { environmentIntensity?: number }).environmentIntensity =
      environmentEnabled
        ? Math.max(0, content.environmentIntensity ?? 1) * lightingProfile.environmentScale
        : 0;

    // Backgrounds must preserve alpha in the layer compositor. A Three.js
    // Scene.background always writes opaque pixels, so solid colors use the
    // renderer clear and environments use a blended camera-locked backdrop.
    this.scene.background = null;
    const environmentBackdrop = this.ensureEnvironmentBackdrop();
    const backgroundMode = content.backgroundMode ?? 'transparent';
    environmentBackdrop.visible =
      backgroundMode === 'environment'
      && !!this.environmentMap
      && this.backgroundAlpha(content) > 0;
    environmentBackdrop.material.envMap = this.environmentMap;
    environmentBackdrop.material.opacity = this.backgroundAlpha(content);
    environmentBackdrop.material.color.setScalar(Math.max(0, content.environmentIntensity ?? 1));

  }

  private configureRenderer(renderer: THREE.WebGLRenderer, content: Model3DContent) {
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = Math.max(0.05, content.toneMappingExposure ?? 1);
    renderer.shadowMap.enabled = content.shadowsEnabled ?? true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
  }

  // Main update function (audioState provides beat/phase data for enhanced reactivity)
  update(content: Model3DContent, audioLevel: number = 0, audioState?: any) {
    if (!this.model) return;

    this.currentContent = content;
    const time = (performance.now() - this.startTime) / 1000;

    // Update embedded animation mixer (GLTF/FBX skeletal/keyframe animations)
    if (this.mixer && this.hasFileAnimations) {
      const useFileAnim = (content as any).useFileAnimation !== false; // default true
      if (useFileAnim) {
        const fileAnimSpeed = (content as any).fileAnimationSpeed ?? content.animationSpeed ?? 1;
        this.mixer.timeScale = fileAnimSpeed;
        const delta = this.clock.getDelta();
        this.mixer.update(delta);
      } else {
        // Paused — don't update mixer but keep it alive
        this.clock.getDelta(); // consume delta to prevent accumulation
      }
    }

    // Setup lighting if changed
    this.setupLighting(content.lightingPreset);
    this.updateLightingRig(content, time);
    this.updateScenePresentation(content, this.renderer);
    if (this.renderer) this.configureRenderer(this.renderer, content);

    // Update disco lights animation
    if (content.lightingPreset === 'disco') {
      this.updateDiscoLights(time);
    }

    // Apply transform
    const baseScale = 2 / this.modelSize;
    this.model.scale.setScalar(content.scaleUniform * baseScale);
    this.model.rotation.set(
      content.rotationX * Math.PI / 180,
      content.rotationY * Math.PI / 180
        + (content.camera.autoRotate ? time * content.camera.rotateSpeed * 0.3 : 0),
      content.rotationZ * Math.PI / 180
    );
    this.model.position.set(content.positionX, content.positionY, content.positionZ);

    // Animation Type dropdown — additive on top of static transform.
    this.applyAnimationTransform(content, time);

    // Audio reactivity for scale
    if (content.audio.enabled && audioLevel > 0) {
      const scaleBoost = 1 + audioLevel * content.audio.scaleResponse * 0.5;
      this.model.scale.multiplyScalar(scaleBoost);
    }

    // Beat-sync effects
    const beatIntensity = typeof audioState?.beat === 'number'
      ? audioState.beat
      : (audioState?.beat?.beatIntensity || 0);
    const beatPhase = audioState?.beatPhase || 0;

    if (content.audio.enabled && beatIntensity > 0) {
      // Beat scale punch
      if (content.beatScale > 0) {
        const punch = 1 + content.beatScale * beatIntensity * 0.3;
        this.model.scale.multiplyScalar(punch);
      }
      // Beat rotation kick
      if (content.beatRotate > 0) {
        this.model.rotation.y += content.beatRotate * beatIntensity * Math.PI * 0.1;
      }
      // Beat explode (scatter vertices outward on beat via deformation boost)
      // This is handled via the shader uniform below
    }

    // Audio reactivity for rotation (continuous)
    if (content.audio.enabled && audioLevel > 0 && content.audio.rotationResponse > 0) {
      this.model.rotation.y += audioLevel * content.audio.rotationResponse * 0.05;
    }

    // Apply/update material with morphing
    this.applyMaterial(content, time, content.audio.enabled ? audioLevel : 0);

    // Animation Type material side (fadeIn/colorCycle/texturePan) — must run AFTER
    // applyMaterial so we override its color/opacity rather than getting overwritten.
    this.applyAnimationMaterial(content, time);

    // Update shader uniforms (pass beat data for deformation response)
    this.updateShaderUniforms(content, time, content.audio.enabled ? audioLevel : 0, beatIntensity, beatPhase);

    // Update wireframe overlay
    this.updateWireframe(content, time);

    // Update vertex decorations
    this.updateVertexDecorations(
      content,
      time,
      content.audio.enabled ? audioLevel : 0,
      beatIntensity,
    );

    // Update echo instances
    this.updateEchoInstances(content, time);

    // Update camera
    this.updateCamera(content, time);
  }

  // Render the scene
  render() {
    if (this.renderer) {
      if (this.currentContent) this.applyBackgroundClear(this.renderer, this.currentContent);
      this.environmentBackdrop?.position.copy(this.camera.position);
      this.renderer.render(this.scene, this.camera);
    }
  }

  /** Render this 3D scene to an external WebGLRenderTarget using a shared renderer.
   *  This avoids cross-context issues by keeping everything in one WebGL context. */
  renderTo(externalRenderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget) {
    const content = this.currentContent;
    if (!content) return;

    // Model layers share the main compositor renderer. Every piece of mutable
    // renderer state must be restored so exposure, shadows, or color settings
    // from this scene cannot leak into the next layer.
    const previousTarget = externalRenderer.getRenderTarget();
    const previousClearAlpha = externalRenderer.getClearAlpha();
    externalRenderer.getClearColor(this.rendererClearColor);
    const previousClearColor = this.rendererClearColor.clone();
    const previousToneMapping = externalRenderer.toneMapping;
    const previousExposure = externalRenderer.toneMappingExposure;
    const previousOutputColorSpace = externalRenderer.outputColorSpace;
    const previousShadowEnabled = externalRenderer.shadowMap.enabled;
    const previousShadowType = externalRenderer.shadowMap.type;
    const previousAutoClear = externalRenderer.autoClear;

    try {
      this.configureRenderer(externalRenderer, content);
      this.updateScenePresentation(content, externalRenderer);
      externalRenderer.autoClear = false;
      externalRenderer.setRenderTarget(target);
      this.applyBackgroundClear(externalRenderer, content);
      externalRenderer.clear(true, true, true);
      this.environmentBackdrop?.position.copy(this.camera.position);
      externalRenderer.render(this.scene, this.camera);
    } finally {
      externalRenderer.setRenderTarget(previousTarget);
      externalRenderer.setClearColor(previousClearColor, previousClearAlpha);
      externalRenderer.toneMapping = previousToneMapping;
      externalRenderer.toneMappingExposure = previousExposure;
      externalRenderer.outputColorSpace = previousOutputColorSpace;
      externalRenderer.shadowMap.enabled = previousShadowEnabled;
      externalRenderer.shadowMap.type = previousShadowType;
      externalRenderer.autoClear = previousAutoClear;
    }
  }

  // Resize renderer
  resize(width: number, height: number) {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    if (this.renderer) {
      this.renderer.setSize(width, height, false);
    }
  }

  // Dispose of Three.js object
  private disposeObject(obj: THREE.Object3D) {
    obj.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry?.dispose();
        const materials = new Set<THREE.Material>([
          ...this.materialList(child.material),
          ...this.materialList(child.userData.sourceMaterial),
        ]);
        materials.forEach((material) => material.dispose());
        delete child.userData.sourceMaterial;
      }
      if (child instanceof THREE.LineSegments) {
        child.geometry?.dispose();
        (child.material as THREE.Material)?.dispose();
      }
    });
  }

  // Full cleanup
  dispose() {
    // Clean up animation mixer
    if (this.mixer) {
      this.mixer.stopAllAction();
      if (this.model) {
        this.mixer.uncacheRoot(this.model);
      }
      this.mixer = null;
    }
    this.animationActions = [];
    this.animationClips = [];
    this.hasFileAnimations = false;

    // Attached wireframe overlays and echo instances share the source model's
    // geometry. Remove their owned materials before the source geometry is
    // disposed so shutdown cannot double-dispose or corrupt a later load.
    this.clearWireframeOverlays();
    this.clearVertexDecorations();
    this.clearEchoInstances();

    if (this.model) {
      this.scene.remove(this.model);
      this.disposeObject(this.model);
      this.model = null;
    }
    this.lights.forEach((light) => this.scene.remove(light));
    this.lights = [];
    this.ambientLight = null;
    this.keyLight = null;
    this.fillLight = null;
    this.rimLight = null;
    this.environmentMap?.dispose();
    this.environmentMap = null;
    this.environmentRenderer = null;
    if (this.environmentBackdrop) {
      this.scene.remove(this.environmentBackdrop);
      this.environmentBackdrop.geometry.dispose();
      this.environmentBackdrop.material.dispose();
      this.environmentBackdrop = null;
    }
    this.scene.environment = null;
    this.scene.background = null;
    this.originalPositions.clear();
    this.originalNormals.clear();
    if (this.renderer) this.renderer.dispose();
  }

  // Get WebGL context
  getContext(): WebGLRenderingContext | WebGL2RenderingContext | null {
    return this.renderer ? this.renderer.getContext() : null;
  }

  // Get canvas
  getCanvas(): HTMLCanvasElement | null {
    return this.canvas;
  }
}
