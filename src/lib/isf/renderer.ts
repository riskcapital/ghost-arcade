// ISF Shader Renderer for Three.js
import * as THREE from 'three';
import { parseISF, createUniformsFromInputs, type ISFMetadata } from './parser';
import { audioTextures } from '../audio/audioTextures';
import type { AudioState } from '../stores/audio';

export interface ISFShaderInstance {
  id: string;
  name: string;
  metadata: ISFMetadata;
  material: THREE.RawShaderMaterial;
  uniforms: Record<string, { value: unknown }>;
  startTime: number;
  inputTextures: Map<string, THREE.Texture>;
}

/** Offline-render time override. When non-null every ISF shader's
 *  TIME uniform reads `_manualTime` instead of `performance.now() -
 *  shader.startTime`. Set by src/lib/recording/offlineRender.ts so
 *  deterministic frame-by-frame rendering matches the engine's
 *  manualTime virtual clock. `null` = normal real-time playback. */
let _manualTime: number | null = null;
export function setISFManualTime(time: number | null) { _manualTime = time; }

// Simple passthrough vertex shader for fullscreen quad
// Uses explicit attribute/uniform declarations for RawShaderMaterial
// (RawShaderMaterial does NOT auto-inject Three.js built-in declarations)
const isfVertexShader = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 projectionMatrix;
uniform mat4 modelViewMatrix;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// Fallback shader that shows a colorful animated gradient when the main shader fails
const fallbackFragmentShader = `
precision highp float;
uniform vec2 RENDERSIZE;
uniform float TIME;
varying vec2 vUv;

void main() {
  vec2 uv = vUv;

  // Animated gradient to show shader is running but had errors
  float t = TIME * 0.5;
  vec3 col1 = vec3(0.8, 0.2, 0.5); // Pink
  vec3 col2 = vec3(0.2, 0.5, 0.8); // Blue
  vec3 col3 = vec3(0.5, 0.8, 0.2); // Green

  float pattern = sin(uv.x * 10.0 + t) * sin(uv.y * 10.0 + t * 0.7);
  vec3 color = mix(col1, col2, uv.x);
  color = mix(color, col3, uv.y);
  color += pattern * 0.2;

  // Add text indicator - "SHADER ERROR" pattern
  float stripe = step(0.48, uv.y) * step(uv.y, 0.52);
  color = mix(color, vec3(1.0, 0.0, 0.0), stripe * 0.5);

  gl_FragColor = vec4(color, 1.0);
}
`;

// Track shaders with compilation errors to avoid repeated error logs
const erroredShaders = new Set<string>();

// ── Performance caches ──

// Cache parsed ISF results by source hash to avoid redundant parsing
// Key: simple hash of shader source, Value: { metadata, fragmentShader }
const parsedISFCache = new Map<string, ReturnType<typeof parseISF>>();

// Cache shader compilation test results to avoid redundant GPU compilation
// Key: hash of compiled fragment shader, Value: true (compiled OK) or error string
const shaderCompileCache = new Map<string, true | string>();

/** Fast string hash (djb2) — not crypto-secure, just for cache keying */
function hashString(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

// Shared WebGL context for shader compilation testing
// This avoids creating/destroying contexts for every shader which causes context exhaustion
let sharedTestCanvas: HTMLCanvasElement | null = null;
let sharedTestGl: WebGLRenderingContext | null = null;

function getSharedTestContext(): WebGLRenderingContext | null {
  if (sharedTestGl) {
    // Check if context is still valid
    if (!sharedTestGl.isContextLost()) {
      return sharedTestGl;
    }
    // Context was lost, need to recreate
    sharedTestGl = null;
    sharedTestCanvas = null;
  }

  if (!sharedTestCanvas) {
    sharedTestCanvas = document.createElement('canvas');
    sharedTestCanvas.width = 1;
    sharedTestCanvas.height = 1;
  }

  sharedTestGl = (sharedTestCanvas.getContext('webgl', {
    failIfMajorPerformanceCaveat: false,
    preserveDrawingBuffer: false,
    antialias: false,
    depth: false,
    stencil: false
  }) || sharedTestCanvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;

  return sharedTestGl;
}

/**
 * Create an ISF shader instance from shader source code
 * If the shader fails to compile, returns a fallback shader instance
 */
export function createISFShader(
  id: string,
  name: string,
  shaderSource: string
): ISFShaderInstance | null {
  try {
    // Cache parsed ISF to avoid redundant metadata extraction + GLSL conversion
    const sourceHash = hashString(shaderSource);
    let parsed = parsedISFCache.get(sourceHash);
    if (!parsed) {
      parsed = parseISF(shaderSource);
      parsedISFCache.set(sourceHash, parsed);
    }
    const uniforms = createUniformsFromInputs(parsed.metadata.INPUTS);

    // Initialize Vector uniforms with proper Three.js types
    uniforms.RENDERSIZE.value = new THREE.Vector2(1920, 1080);
    uniforms.renderSize.value = new THREE.Vector2(1920, 1080); // Also set lowercase variant
    uniforms.DATE.value = new THREE.Vector4(2024, 1, 1, 0);

    // Initialize point2D and color inputs with Vector types
    for (const input of parsed.metadata.INPUTS) {
      if (input.TYPE === 'point2D' && uniforms[input.NAME]) {
        const val = uniforms[input.NAME].value as number[];
        uniforms[input.NAME].value = new THREE.Vector2(val[0] || 0.5, val[1] || 0.5);
      } else if (input.TYPE === 'color' && uniforms[input.NAME]) {
        const val = uniforms[input.NAME].value as number[];
        uniforms[input.NAME].value = new THREE.Vector4(val[0] || 1, val[1] || 1, val[2] || 1, val[3] || 1);
      } else if (input.TYPE === 'image' && uniforms[`_${input.NAME}_imgSize`]) {
        uniforms[`_${input.NAME}_imgSize`].value = new THREE.Vector2(1, 1);
      }
    }

    // Log the parsed shader for debugging
    console.log(`ISF shader '${name}' parsed, fragment shader length:`, parsed.fragmentShader.length);

    let material: THREE.RawShaderMaterial;
    let usedFallback = false;
    let materialDisposed = false;

    try {
      // CRITICAL: Use RawShaderMaterial instead of ShaderMaterial.
      // Three.js r182 forces GLSL 300 es conversion on ShaderMaterial
      // (adds #version 300 es, redefines varying/texture2D/gl_FragColor etc.)
      // which breaks our GLSL ES 1.0 ISF shaders. RawShaderMaterial sends
      // shader source directly to WebGL2, which natively supports GLSL ES 1.0.
      material = new THREE.RawShaderMaterial({
        vertexShader: isfVertexShader,
        fragmentShader: parsed.fragmentShader,
        uniforms,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      });

      // Force shader program compilation to catch errors early
      // Uses cache to skip redundant GPU compilations for already-validated shaders
      const fragHash = hashString(parsed.fragmentShader);
      const cachedResult = shaderCompileCache.get(fragHash);

      if (cachedResult === true) {
        // Already validated — skip GPU compilation
      } else if (typeof cachedResult === 'string') {
        // Previously failed — skip GPU compilation and use cached error
        material.dispose();
        materialDisposed = true;
        throw new Error(`Shader compilation failed (cached): ${cachedResult}`);
      } else {
        // Not cached — compile on shared WebGL context to validate
        const gl = getSharedTestContext();
        if (gl) {
          const fragShader = gl.createShader(gl.FRAGMENT_SHADER);
          if (fragShader) {
            gl.shaderSource(fragShader, parsed.fragmentShader);
            gl.compileShader(fragShader);

            if (!gl.getShaderParameter(fragShader, gl.COMPILE_STATUS)) {
              const error = gl.getShaderInfoLog(fragShader) || 'Unknown compilation error';
              console.error(`ISF shader '${name}' compilation failed:`, error);
              gl.deleteShader(fragShader);
              shaderCompileCache.set(fragHash, error);

              // Use fallback shader instead
              material.dispose();
              materialDisposed = true;
              throw new Error(`Shader compilation failed: ${error}`);
            }
            gl.deleteShader(fragShader);
            shaderCompileCache.set(fragHash, true);
          }
          // Note: Don't destroy shared context - it's reused for all shader tests
        }
      }
    } catch (compileError) {
      console.warn(`ISF shader '${name}' failed to compile, using fallback. Error:`, compileError);

      // Dispose the failed material if it wasn't already disposed in the try block
      if (!materialDisposed) {
        material!.dispose();
      }

      // Create fallback shader (also RawShaderMaterial for consistency)
      material = new THREE.RawShaderMaterial({
        vertexShader: isfVertexShader,
        fragmentShader: fallbackFragmentShader,
        uniforms: {
          RENDERSIZE: { value: new THREE.Vector2(1920, 1080) },
          TIME: { value: 0 },
        },
        transparent: true,
        depthTest: false,
        depthWrite: false,
      });

      usedFallback = true;

      // Track this shader as having errors
      if (!erroredShaders.has(id)) {
        erroredShaders.add(id);
        console.error(`[ISF Renderer] Shader '${name}' (${id}) has compilation errors. Using animated fallback.`);
      }
    }

    console.log(`ISF shader '${name}' created ${usedFallback ? '(with fallback)' : 'successfully'}, inputs:`, parsed.metadata.INPUTS.map(i => i.NAME));

    return {
      id,
      name,
      metadata: parsed.metadata,
      material,
      uniforms: usedFallback ? material.uniforms : uniforms,
      startTime: performance.now() / 1000,
      inputTextures: new Map(),
    };
  } catch (error) {
    console.error('Failed to create ISF shader:', name, error);

    // Even on complete failure, return a fallback shader
    const fallbackUniforms = {
      RENDERSIZE: { value: new THREE.Vector2(1920, 1080) },
      TIME: { value: 0 },
    };

    const material = new THREE.RawShaderMaterial({
      vertexShader: isfVertexShader,
      fragmentShader: fallbackFragmentShader,
      uniforms: fallbackUniforms,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });

    return {
      id,
      name,
      metadata: { INPUTS: [] },
      material,
      uniforms: fallbackUniforms,
      startTime: performance.now() / 1000,
      inputTextures: new Map(),
    };
  }
}

/**
 * Update ISF shader uniforms (call each frame)
 */
export function updateISFShader(
  shader: ISFShaderInstance,
  width: number,
  height: number,
  deltaTime: number = 0.016,
  audioState?: AudioState | null
): void {
  const currentTime = _manualTime !== null
    ? _manualTime
    : performance.now() / 1000 - shader.startTime;

  // Use THREE.Vector2/Vector4 for proper uniform handling
  // Update both RENDERSIZE (ISF standard) and renderSize (camelCase variant)
  if (shader.uniforms.RENDERSIZE) {
    if (shader.uniforms.RENDERSIZE.value instanceof THREE.Vector2) {
      shader.uniforms.RENDERSIZE.value.set(width, height);
    } else {
      shader.uniforms.RENDERSIZE.value = new THREE.Vector2(width, height);
    }
  }
  if (shader.uniforms.renderSize) {
    if (shader.uniforms.renderSize.value instanceof THREE.Vector2) {
      shader.uniforms.renderSize.value.set(width, height);
    } else {
      shader.uniforms.renderSize.value = new THREE.Vector2(width, height);
    }
  }

  if (shader.uniforms.TIME) {
    shader.uniforms.TIME.value = currentTime;
  }

  if (shader.uniforms.TIMEDELTA) {
    shader.uniforms.TIMEDELTA.value = deltaTime;
  }

  if (shader.uniforms.FRAMEINDEX) {
    shader.uniforms.FRAMEINDEX.value = (shader.uniforms.FRAMEINDEX.value as number) + 1;
  }

  // Update DATE
  if (shader.uniforms.DATE) {
    const now = new Date();
    if (shader.uniforms.DATE.value instanceof THREE.Vector4) {
      shader.uniforms.DATE.value.set(
        now.getFullYear(),
        now.getMonth() + 1,
        now.getDate(),
        now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()
      );
    } else {
      shader.uniforms.DATE.value = new THREE.Vector4(
        now.getFullYear(),
        now.getMonth() + 1,
        now.getDate(),
        now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()
      );
    }
  }

  // Audio-reactive uniforms — ALWAYS bind textures (null sampler2D = black on most GPUs)
  if (shader.uniforms.audioFFT) {
    shader.uniforms.audioFFT.value = audioTextures.fft;
  }
  if (shader.uniforms.audioWaveform) {
    shader.uniforms.audioWaveform.value = audioTextures.waveform;
  }

  if (audioState && audioState.isActive) {
    if (shader.uniforms.audioLevel) {
      shader.uniforms.audioLevel.value = audioState.amplitude;
    }
    if (shader.uniforms.audioBass) {
      shader.uniforms.audioBass.value = audioState.bands.bass;
    }
    if (shader.uniforms.audioMid) {
      shader.uniforms.audioMid.value = audioState.bands.mid;
    }
    if (shader.uniforms.audioHigh) {
      shader.uniforms.audioHigh.value = audioState.bands.high;
    }
    if (shader.uniforms.audioBeat) {
      shader.uniforms.audioBeat.value = audioState.beat.beatIntensity;
    }
    if (shader.uniforms.audioBeatPhase) {
      shader.uniforms.audioBeatPhase.value = audioState.beatPhase;
    }
    if (shader.uniforms.audioBPM) {
      shader.uniforms.audioBPM.value = audioState.bpm;
    }
    if (shader.uniforms.audioSpectralCentroid) {
      shader.uniforms.audioSpectralCentroid.value = audioState.spectralCentroid ?? 0;
    }
  } else {
    // Reset scalar uniforms to 0 so shader fallback branches activate
    if (shader.uniforms.audioLevel) shader.uniforms.audioLevel.value = 0;
    if (shader.uniforms.audioBass) shader.uniforms.audioBass.value = 0;
    if (shader.uniforms.audioMid) shader.uniforms.audioMid.value = 0;
    if (shader.uniforms.audioHigh) shader.uniforms.audioHigh.value = 0;
    if (shader.uniforms.audioBeat) shader.uniforms.audioBeat.value = 0;
    if (shader.uniforms.audioBeatPhase) shader.uniforms.audioBeatPhase.value = 0;
    if (shader.uniforms.audioBPM) shader.uniforms.audioBPM.value = 0;
    if (shader.uniforms.audioSpectralCentroid) shader.uniforms.audioSpectralCentroid.value = 0;
  }
}

/**
 * Set an ISF input parameter value
 */
export function setISFInputValue(
  shader: ISFShaderInstance,
  inputName: string,
  value: number | boolean | number[] | THREE.Texture
): void {
  if (shader.uniforms[inputName]) {
    shader.uniforms[inputName].value = value;
  }
}

/**
 * Set an input image texture
 */
export function setISFInputTexture(
  shader: ISFShaderInstance,
  inputName: string,
  texture: THREE.Texture
): void {
  if (!shader.uniforms[inputName]) return;

  shader.uniforms[inputName].value = texture;

  const imgSizeUniform = shader.uniforms[`_${inputName}_imgSize`];
  if (imgSizeUniform) {
    const image = texture.image as HTMLImageElement | HTMLVideoElement | HTMLCanvasElement | undefined;
    const width = (image as HTMLImageElement)?.width || (image as HTMLVideoElement)?.videoWidth || 1;
    const height = (image as HTMLImageElement)?.height || (image as HTMLVideoElement)?.videoHeight || 1;

    if (imgSizeUniform.value instanceof THREE.Vector2) {
      imgSizeUniform.value.set(width, height);
    } else {
      imgSizeUniform.value = new THREE.Vector2(width, height);
    }
  }

  shader.inputTextures.set(inputName, texture);
}

/**
 * Get current parameter values for UI display
 */
export function getISFParameterValues(
  shader: ISFShaderInstance
): Record<string, number | boolean | number[]> {
  const values: Record<string, number | boolean | number[]> = {};

  for (const input of shader.metadata.INPUTS) {
    if (shader.uniforms[input.NAME]) {
      values[input.NAME] = shader.uniforms[input.NAME].value as number | boolean | number[];
    }
  }

  return values;
}

/**
 * Render ISF shader to a render target
 */
export function renderISFToTarget(
  renderer: THREE.WebGLRenderer,
  shader: ISFShaderInstance,
  target: THREE.WebGLRenderTarget,
  camera: THREE.Camera
): void {
  // Create a fullscreen quad with the shader material
  const geometry = new THREE.PlaneGeometry(2, 2);
  const mesh = new THREE.Mesh(geometry, shader.material);
  const scene = new THREE.Scene();
  scene.add(mesh);

  // Update shader uniforms
  updateISFShader(shader, target.width, target.height);

  // Render to target
  renderer.setRenderTarget(target);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);

  // Cleanup
  geometry.dispose();
}

/**
 * Dispose of ISF shader resources
 */
export function disposeISFShader(shader: ISFShaderInstance): void {
  shader.material.dispose();
  for (const texture of shader.inputTextures.values()) {
    texture.dispose();
  }
  shader.inputTextures.clear();
}
