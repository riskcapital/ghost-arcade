import * as THREE from 'three';
import type { Effect } from '../types';

interface MagnifyInstance {
  fastA: THREE.WebGLRenderTarget;
  fastB: THREE.WebGLRenderTarget;
  slowA: THREE.WebGLRenderTarget;
  slowB: THREE.WebGLRenderTarget;
  output: THREE.WebGLRenderTarget;
  initialized: boolean;
  configuredW: number;
  configuredH: number;
}

const vertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

const lowpassFragmentShader = `
  precision highp float;
  uniform sampler2D uCurrent;
  uniform sampler2D uPrevious;
  uniform float uAlpha;
  uniform float uHasPrior;
  varying vec2 vUv;

  void main() {
    vec4 cur = texture2D(uCurrent, vUv);
    vec4 prev = uHasPrior > 0.5 ? texture2D(uPrevious, vUv) : cur;
    gl_FragColor = mix(prev, cur, clamp(uAlpha, 0.0, 1.0));
  }
`;

const magnifyFragmentShader = `
  precision highp float;
  uniform sampler2D uCurrent;
  uniform sampler2D uFast;
  uniform sampler2D uSlow;
  uniform vec2 uResolution;
  uniform float uMode;
  uniform float uAmplification;
  uniform float uColorMix;
  uniform float uMotionMix;
  uniform float uSpatialRadius;
  uniform float uNoiseFloor;
  uniform float uMaxShift;
  uniform float uOutputMix;
  uniform float uShowBand;
  uniform float uChromaOnly;
  varying vec2 vUv;

  float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
  vec3 sat3(vec3 v) { return clamp(v, vec3(0.0), vec3(1.0)); }

  vec3 sampleCurrent(vec2 uv) {
    return texture2D(uCurrent, clamp(uv, vec2(0.0), vec2(1.0))).rgb;
  }

  vec2 gradient(vec2 uv, float radius) {
    vec2 px = max(vec2(1.0) / max(uResolution, vec2(2.0)), vec2(0.000001)) * max(1.0, radius);
    float l = lum(sampleCurrent(uv - vec2(px.x, 0.0)));
    float r = lum(sampleCurrent(uv + vec2(px.x, 0.0)));
    float d = lum(sampleCurrent(uv - vec2(0.0, px.y)));
    float u = lum(sampleCurrent(uv + vec2(0.0, px.y)));
    return vec2(r - l, u - d) * 0.5;
  }

  void main() {
    vec4 cur4 = texture2D(uCurrent, vUv);
    vec3 cur = cur4.rgb;
    vec3 fast = texture2D(uFast, vUv).rgb;
    vec3 slow = texture2D(uSlow, vUv).rgb;
    vec3 band = fast - slow;
    float bandLum = lum(band);
    float amp = uAmplification;
    float mode = floor(uMode + 0.5);

    if (mode == 3.0) {
      amp = -abs(amp);
    }

    vec3 bandForColor = band;
    if (uChromaOnly > 0.5) {
      bandForColor -= vec3(bandLum);
    }

    vec3 colorMagnified = cur + bandForColor * amp * uColorMix;

    vec2 grad = gradient(vUv, uSpatialRadius);
    float denom = max(dot(grad, grad), max(0.000001, uNoiseFloor));
    vec2 flow = -grad * bandLum / denom;
    vec2 shiftPx = clamp(flow * amp * uMotionMix, vec2(-uMaxShift), vec2(uMaxShift));
    vec2 shift = shiftPx / max(uResolution, vec2(1.0));
    vec3 motionMagnified = sampleCurrent(vUv + shift);

    vec3 outColor = cur;
    if (mode == 0.0) {
      outColor = colorMagnified;
    } else if (mode == 1.0) {
      outColor = motionMagnified;
    } else if (mode == 2.0 || mode == 3.0) {
      outColor = mix(colorMagnified, motionMagnified, clamp(uMotionMix, 0.0, 1.0));
    }

    if (uShowBand > 0.5) {
      outColor = vec3(0.5) + band * amp * 0.08;
    }

    gl_FragColor = vec4(mix(cur, sat3(outColor), clamp(uOutputMix, 0.0, 1.0)), cur4.a);
  }
`;

function createTarget(w: number, h: number): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(w, h, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    depthBuffer: false,
    stencilBuffer: false,
  });
}

function cutoffToAlpha(hz: number, dt: number): number {
  const safeHz = Math.max(0.001, Math.min(30, hz));
  const safeDt = Math.max(1 / 240, Math.min(0.25, dt || 1 / 60));
  return 1 - Math.exp(-2 * Math.PI * safeHz * safeDt);
}

export class TemporalMagnificationRunner {
  private instances = new Map<string, MagnifyInstance>();
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: THREE.Mesh;
  private lowpassMaterial: THREE.ShaderMaterial;
  private outputMaterial: THREE.ShaderMaterial;

  constructor() {
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.scene.add(this.quad);
    this.lowpassMaterial = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader: lowpassFragmentShader,
      uniforms: {
        uCurrent: { value: null },
        uPrevious: { value: null },
        uAlpha: { value: 1 },
        uHasPrior: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
    this.outputMaterial = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader: magnifyFragmentShader,
      uniforms: {
        uCurrent: { value: null },
        uFast: { value: null },
        uSlow: { value: null },
        uResolution: { value: new THREE.Vector2(1920, 1080) },
        uMode: { value: 0 },
        uAmplification: { value: 24 },
        uColorMix: { value: 1 },
        uMotionMix: { value: 0.35 },
        uSpatialRadius: { value: 2 },
        uNoiseFloor: { value: 0.0008 },
        uMaxShift: { value: 24 },
        uOutputMix: { value: 1 },
        uShowBand: { value: 0 },
        uChromaOnly: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
  }

  run(
    sourceTexture: THREE.Texture,
    effect: Effect,
    layerId: string,
    dt: number,
    renderer: THREE.WebGLRenderer,
    width: number,
    height: number,
  ): THREE.Texture {
    const key = `${layerId}::${effect.id}`;
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    let inst = this.instances.get(key);
    if (!inst) {
      inst = this.createInstance(w, h);
      this.instances.set(key, inst);
    } else if (inst.configuredW !== w || inst.configuredH !== h) {
      this.resizeInstance(inst, w, h);
    }

    const p = effect.params || {};
    const lowHz = Math.max(0.01, p.eulerianLowHz ?? 0.75);
    const highHz = Math.max(lowHz + 0.01, p.eulerianHighHz ?? 2.5);
    const alphaFast = cutoffToAlpha(highHz, dt);
    const alphaSlow = cutoffToAlpha(lowHz, dt);

    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    const prevClearColor = new THREE.Color();
    renderer.getClearColor(prevClearColor);
    const prevClearAlpha = renderer.getClearAlpha();
    renderer.autoClear = false;
    renderer.setClearColor(0x000000, 0);

    const fastRead = inst.fastA;
    const fastWrite = inst.fastB;
    const slowRead = inst.slowA;
    const slowWrite = inst.slowB;

    this.renderLowpass(renderer, sourceTexture, fastRead.texture, fastWrite, alphaFast, inst.initialized);
    this.renderLowpass(renderer, sourceTexture, slowRead.texture, slowWrite, alphaSlow, inst.initialized);
    this.renderOutput(renderer, sourceTexture, fastWrite.texture, slowWrite.texture, inst.output, p, w, h);

    inst.fastA = fastWrite;
    inst.fastB = fastRead;
    inst.slowA = slowWrite;
    inst.slowB = slowRead;
    inst.initialized = true;

    renderer.autoClear = prevAutoClear;
    renderer.setClearColor(prevClearColor, prevClearAlpha);
    renderer.setRenderTarget(prevTarget);

    return inst.output.texture;
  }

  private renderLowpass(
    renderer: THREE.WebGLRenderer,
    source: THREE.Texture,
    previous: THREE.Texture,
    target: THREE.WebGLRenderTarget,
    alpha: number,
    hasPrior: boolean,
  ): void {
    this.lowpassMaterial.uniforms.uCurrent.value = source;
    this.lowpassMaterial.uniforms.uPrevious.value = previous;
    this.lowpassMaterial.uniforms.uAlpha.value = alpha;
    this.lowpassMaterial.uniforms.uHasPrior.value = hasPrior ? 1 : 0;
    this.quad.material = this.lowpassMaterial;
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(this.scene, this.camera);
  }

  private renderOutput(
    renderer: THREE.WebGLRenderer,
    source: THREE.Texture,
    fast: THREE.Texture,
    slow: THREE.Texture,
    target: THREE.WebGLRenderTarget,
    params: Record<string, any>,
    width: number,
    height: number,
  ): void {
    const u = this.outputMaterial.uniforms;
    u.uCurrent.value = source;
    u.uFast.value = fast;
    u.uSlow.value = slow;
    u.uResolution.value.set(width, height);
    u.uMode.value = params.eulerianMode ?? 0;
    u.uAmplification.value = params.eulerianAmplification ?? 24;
    u.uColorMix.value = params.eulerianColorMix ?? 1;
    u.uMotionMix.value = params.eulerianMotionMix ?? 0.35;
    u.uSpatialRadius.value = params.eulerianSpatialRadius ?? 2;
    u.uNoiseFloor.value = params.eulerianNoiseFloor ?? 0.0008;
    u.uMaxShift.value = params.eulerianMaxShift ?? 24;
    u.uOutputMix.value = params.eulerianOutputMix ?? 1;
    u.uShowBand.value = params.eulerianShowBand ?? 0;
    u.uChromaOnly.value = params.eulerianChromaOnly ?? 0;
    this.quad.material = this.outputMaterial;
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(this.scene, this.camera);
  }

  private createInstance(w: number, h: number): MagnifyInstance {
    return {
      fastA: createTarget(w, h),
      fastB: createTarget(w, h),
      slowA: createTarget(w, h),
      slowB: createTarget(w, h),
      output: createTarget(w, h),
      initialized: false,
      configuredW: w,
      configuredH: h,
    };
  }

  private resizeInstance(inst: MagnifyInstance, w: number, h: number): void {
    this.disposeInstance(inst);
    const next = this.createInstance(w, h);
    Object.assign(inst, next);
  }

  reapStale(liveKeys: Set<string>): void {
    for (const [key, inst] of this.instances) {
      if (!liveKeys.has(key)) {
        this.disposeInstance(inst);
        this.instances.delete(key);
      }
    }
  }

  dispose(): void {
    for (const inst of this.instances.values()) this.disposeInstance(inst);
    this.instances.clear();
    try { this.quad.geometry.dispose(); } catch {}
    try { this.lowpassMaterial.dispose(); } catch {}
    try { this.outputMaterial.dispose(); } catch {}
  }

  private disposeInstance(inst: MagnifyInstance): void {
    try { inst.fastA.dispose(); } catch {}
    try { inst.fastB.dispose(); } catch {}
    try { inst.slowA.dispose(); } catch {}
    try { inst.slowB.dispose(); } catch {}
    try { inst.output.dispose(); } catch {}
  }
}

export function isTemporalMagnificationEffect(type: string): boolean {
  return type === 'eulerianMagnify';
}
