// Fluid Simulation - WebGL/Three.js based fluid dynamics
// Implements 2D Navier-Stokes equations with multiple render modes
// Designed to replace the standalone FluidGen plugin with pure WebGL

import * as THREE from 'three';

// Render modes matching FluidGen
export const FLUID_MODES = {
  SMOKE: 0,
  FIRE: 1,
  INK: 2,
  NEON: 3,
  THERMAL: 4,
} as const;

export type FluidMode = typeof FLUID_MODES[keyof typeof FLUID_MODES];

export interface FluidSimulationParams {
  viscosity: number;      // 0.00001 - 0.01
  vorticity: number;      // 0 - 50
  dissipation: number;    // 0 - 0.1
  velocityDissipation: number; // 0 - 0.1
  pressureIterations: number;  // 20-50
  curl: number;          // 0 - 50
}

export interface FluidRenderParams {
  intensity: number;     // 0.5 - 3.0
  contrast: number;      // 0.5 - 2.0
  saturation: number;    // 0 - 1
  hueShift: number;      // 0 - 1
  glow: number;          // 0 - 1
  bgColor: [number, number, number];  // RGB 0-1 range
}

// Vertex shader for fullscreen quad
const vertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec2 vL;
  varying vec2 vR;
  varying vec2 vT;
  varying vec2 vB;
  uniform vec2 texelSize;

  void main() {
    vUv = uv;
    vL = vUv - vec2(texelSize.x, 0.0);
    vR = vUv + vec2(texelSize.x, 0.0);
    vT = vUv + vec2(0.0, texelSize.y);
    vB = vUv - vec2(0.0, texelSize.y);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Simple passthrough vertex shader for basic operations
const simpleVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Advection shader - semi-Lagrangian advection
const advectionShader = /* glsl */ `
  precision highp float;
  uniform sampler2D uVelocity;
  uniform sampler2D uSource;
  uniform vec2 texelSize;
  uniform float dt;
  uniform float dissipation;
  varying vec2 vUv;

  void main() {
    vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
    vec4 result = texture2D(uSource, coord);
    float decay = 1.0 + dissipation * dt;
    gl_FragColor = result / decay;
  }
`;

// Divergence shader - calculate divergence of velocity field
const divergenceShader = /* glsl */ `
  precision highp float;
  uniform sampler2D uVelocity;
  varying vec2 vL;
  varying vec2 vR;
  varying vec2 vT;
  varying vec2 vB;

  void main() {
    float L = texture2D(uVelocity, vL).x;
    float R = texture2D(uVelocity, vR).x;
    float T = texture2D(uVelocity, vT).y;
    float B = texture2D(uVelocity, vB).y;

    float div = 0.5 * (R - L + T - B);
    gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
  }
`;

// Curl shader - calculate curl (vorticity) of velocity field
const curlShader = /* glsl */ `
  precision highp float;
  uniform sampler2D uVelocity;
  varying vec2 vL;
  varying vec2 vR;
  varying vec2 vT;
  varying vec2 vB;

  void main() {
    float L = texture2D(uVelocity, vL).y;
    float R = texture2D(uVelocity, vR).y;
    float T = texture2D(uVelocity, vT).x;
    float B = texture2D(uVelocity, vB).x;

    float vorticity = R - L - T + B;
    gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
  }
`;

// Vorticity confinement shader - add rotational forces back
const vorticityShader = /* glsl */ `
  precision highp float;
  uniform sampler2D uVelocity;
  uniform sampler2D uCurl;
  uniform float curl;
  uniform float dt;
  varying vec2 vUv;
  varying vec2 vL;
  varying vec2 vR;
  varying vec2 vT;
  varying vec2 vB;

  void main() {
    float L = texture2D(uCurl, vL).x;
    float R = texture2D(uCurl, vR).x;
    float T = texture2D(uCurl, vT).x;
    float B = texture2D(uCurl, vB).x;
    float C = texture2D(uCurl, vUv).x;

    vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
    force /= length(force) + 0.0001;
    force *= curl * C;
    force.y *= -1.0;

    vec2 velocity = texture2D(uVelocity, vUv).xy;
    velocity += force * dt;
    velocity = min(max(velocity, -1000.0), 1000.0);
    gl_FragColor = vec4(velocity, 0.0, 1.0);
  }
`;

// Pressure solver (Jacobi iteration)
const pressureShader = /* glsl */ `
  precision highp float;
  uniform sampler2D uPressure;
  uniform sampler2D uDivergence;
  varying vec2 vUv;
  varying vec2 vL;
  varying vec2 vR;
  varying vec2 vT;
  varying vec2 vB;

  void main() {
    float L = texture2D(uPressure, vL).x;
    float R = texture2D(uPressure, vR).x;
    float T = texture2D(uPressure, vT).x;
    float B = texture2D(uPressure, vB).x;
    float C = texture2D(uDivergence, vUv).x;

    float pressure = (L + R + T + B - C) * 0.25;
    gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
  }
`;

// Gradient subtraction - make velocity divergence-free
const gradientSubtractShader = /* glsl */ `
  precision highp float;
  uniform sampler2D uPressure;
  uniform sampler2D uVelocity;
  varying vec2 vL;
  varying vec2 vR;
  varying vec2 vT;
  varying vec2 vB;
  varying vec2 vUv;

  void main() {
    float L = texture2D(uPressure, vL).x;
    float R = texture2D(uPressure, vR).x;
    float T = texture2D(uPressure, vT).x;
    float B = texture2D(uPressure, vB).x;

    vec2 velocity = texture2D(uVelocity, vUv).xy;
    velocity.xy -= vec2(R - L, T - B);
    gl_FragColor = vec4(velocity, 0.0, 1.0);
  }
`;

// Splat shader - add force and density at a point
const splatShader = /* glsl */ `
  precision highp float;
  uniform sampler2D uTarget;
  uniform vec2 point;
  uniform vec3 color;
  uniform float radius;
  uniform float aspectRatio;
  varying vec2 vUv;

  void main() {
    vec2 p = vUv - point;
    p.x *= aspectRatio;

    vec3 splat = exp(-dot(p, p) / radius) * color;
    vec3 base = texture2D(uTarget, vUv).xyz;
    gl_FragColor = vec4(base + splat, 1.0);
  }
`;

// Camera density injection shader - blends a camera texture into the density buffer
const cameraDensityShader = /* glsl */ `
  precision highp float;
  uniform sampler2D uDensity;
  uniform sampler2D uCamera;
  uniform sampler2D uPrevCamera;
  uniform float strength;
  uniform float motionScale;
  varying vec2 vUv;

  void main() {
    vec3 density = texture2D(uDensity, vUv).rgb;
    vec3 cam = texture2D(uCamera, vec2(1.0 - vUv.x, vUv.y)).rgb; // mirror horizontally
    vec3 prev = texture2D(uPrevCamera, vec2(1.0 - vUv.x, vUv.y)).rgb;

    // Motion detection — difference between current and previous frame
    vec3 diff = abs(cam - prev);
    float motion = (diff.r + diff.g + diff.b) / 3.0;

    // Inject density where motion is detected
    vec3 inject = cam * motion * motionScale;
    gl_FragColor = vec4(density + inject * strength, 1.0);
  }
`;

// Camera velocity injection shader - adds velocity from camera motion
const cameraVelocityShader = /* glsl */ `
  precision highp float;
  uniform sampler2D uVelocity;
  uniform sampler2D uCamera;
  uniform sampler2D uPrevCamera;
  uniform float strength;
  varying vec2 vUv;

  void main() {
    vec2 velocity = texture2D(uVelocity, vUv).xy;
    vec2 mirrorUv = vec2(1.0 - vUv.x, vUv.y);

    // Sample camera at surrounding pixels for flow estimation
    float dx = 1.0 / 640.0;
    float dy = 1.0 / 480.0;

    float curr = dot(texture2D(uCamera, mirrorUv).rgb, vec3(0.333));
    float prev = dot(texture2D(uPrevCamera, mirrorUv).rgb, vec3(0.333));
    float motion = abs(curr - prev);

    // Use spatial gradient of current frame for velocity direction
    float currR = dot(texture2D(uCamera, mirrorUv + vec2(dx, 0.0)).rgb, vec3(0.333));
    float currL = dot(texture2D(uCamera, mirrorUv - vec2(dx, 0.0)).rgb, vec3(0.333));
    float currU = dot(texture2D(uCamera, mirrorUv + vec2(0.0, dy)).rgb, vec3(0.333));
    float currD = dot(texture2D(uCamera, mirrorUv - vec2(0.0, dy)).rgb, vec3(0.333));

    vec2 gradient = vec2(currR - currL, currU - currD);
    vec2 camVel = gradient * motion * strength * -200.0; // flip for mirror

    gl_FragColor = vec4(velocity + camVel, 0.0, 1.0);
  }
`;

// Clear shader
const clearShader = /* glsl */ `
  precision highp float;
  uniform float value;
  varying vec2 vUv;

  void main() {
    gl_FragColor = vec4(value);
  }
`;

// Display shader with multiple render modes
const displayShader = /* glsl */ `
  precision highp float;
  uniform sampler2D uDensity;
  uniform sampler2D uVelocity;
  uniform int mode;
  uniform float intensity;
  uniform float contrast;
  uniform float saturation;
  uniform float hueShift;
  uniform float glow;
  uniform vec3 uBgColor;
  varying vec2 vUv;

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

  // Thermal colormap
  vec3 thermal(float t) {
    vec3 a = vec3(0.0, 0.0, 0.0);
    vec3 b = vec3(0.3, 0.0, 0.8);
    vec3 c = vec3(0.8, 0.2, 0.0);
    vec3 d = vec3(1.0, 1.0, 0.0);
    vec3 e = vec3(1.0, 1.0, 1.0);

    t = clamp(t, 0.0, 1.0);
    if (t < 0.25) return mix(a, b, t * 4.0);
    else if (t < 0.5) return mix(b, c, (t - 0.25) * 4.0);
    else if (t < 0.75) return mix(c, d, (t - 0.5) * 4.0);
    else return mix(d, e, (t - 0.75) * 4.0);
  }

  // Fire colormap
  vec3 fire(float t) {
    t = clamp(t, 0.0, 1.0);
    vec3 black = vec3(0.0, 0.0, 0.0);
    vec3 red = vec3(1.0, 0.0, 0.0);
    vec3 orange = vec3(1.0, 0.5, 0.0);
    vec3 yellow = vec3(1.0, 1.0, 0.0);
    vec3 white = vec3(1.0, 1.0, 1.0);

    if (t < 0.2) return mix(black, red, t * 5.0);
    else if (t < 0.5) return mix(red, orange, (t - 0.2) * 3.33);
    else if (t < 0.8) return mix(orange, yellow, (t - 0.5) * 3.33);
    else return mix(yellow, white, (t - 0.8) * 5.0);
  }

  void main() {
    vec3 density = texture2D(uDensity, vUv).rgb;
    vec2 velocity = texture2D(uVelocity, vUv).xy;

    // Calculate base intensity from density
    float d = length(density);
    d = pow(d * intensity, contrast);

    vec3 color;

    if (mode == 0) {
      // SMOKE - soft white/gray smoke
      color = vec3(d);
    }
    else if (mode == 1) {
      // FIRE - fire colors based on density
      color = fire(d);
    }
    else if (mode == 2) {
      // INK - use density color directly
      color = density * intensity;
      color = pow(color, vec3(contrast));
    }
    else if (mode == 3) {
      // NEON - vibrant glowing colors
      float vel = length(velocity) * 0.1;
      vec3 hsv = vec3(d * 0.5 + vel, 1.0, d);
      color = hsv2rgb(hsv);
      color *= intensity;
    }
    else {
      // THERMAL - heat vision
      color = thermal(d);
    }

    // Apply saturation
    if (saturation < 1.0) {
      float gray = dot(color, vec3(0.299, 0.587, 0.114));
      color = mix(vec3(gray), color, saturation);
    }

    // Apply hue shift
    if (hueShift > 0.0) {
      vec3 hsv = rgb2hsv(color);
      hsv.x = fract(hsv.x + hueShift);
      color = hsv2rgb(hsv);
    }

    // Apply glow (bloom-like effect)
    if (glow > 0.0) {
      float bloom = pow(d, 0.5) * glow;
      color += bloom;
    }

    // Mix with background color — use max to blend fluid on top of bg
    color = max(color, uBgColor * (1.0 - clamp(d * 2.0, 0.0, 1.0)));

    gl_FragColor = vec4(color, 1.0);
  }
`;

// Double framebuffer for ping-pong rendering
class DoubleFBO {
  private readTarget: THREE.WebGLRenderTarget;
  private writeTarget: THREE.WebGLRenderTarget;

  constructor(width: number, height: number, options?: THREE.RenderTargetOptions) {
    const defaultOptions: THREE.RenderTargetOptions = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
      ...options,
    };

    this.readTarget = new THREE.WebGLRenderTarget(width, height, defaultOptions);
    this.writeTarget = new THREE.WebGLRenderTarget(width, height, defaultOptions);
  }

  get read(): THREE.WebGLRenderTarget {
    return this.readTarget;
  }

  get write(): THREE.WebGLRenderTarget {
    return this.writeTarget;
  }

  swap(): void {
    const temp = this.readTarget;
    this.readTarget = this.writeTarget;
    this.writeTarget = temp;
  }

  resize(width: number, height: number): void {
    this.readTarget.setSize(width, height);
    this.writeTarget.setSize(width, height);
  }

  dispose(): void {
    this.readTarget.dispose();
    this.writeTarget.dispose();
  }
}

export class FluidSimulation {
  private _width: number;
  private _height: number;
  private texelSizeX: number;
  private texelSizeY: number;

  // Simulation buffers
  private velocity: DoubleFBO;
  private density: DoubleFBO;
  private pressure: DoubleFBO;
  private divergence: THREE.WebGLRenderTarget;
  private curl: THREE.WebGLRenderTarget;

  // Simulation parameters
  private params: FluidSimulationParams;
  private renderParams: FluidRenderParams;
  private mode: FluidMode;

  // Three.js objects
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private quad: THREE.Mesh;

  // Shader materials
  private materials: {
    advection: THREE.ShaderMaterial;
    divergence: THREE.ShaderMaterial;
    curl: THREE.ShaderMaterial;
    vorticity: THREE.ShaderMaterial;
    pressure: THREE.ShaderMaterial;
    gradientSubtract: THREE.ShaderMaterial;
    splat: THREE.ShaderMaterial;
    clear: THREE.ShaderMaterial;
    display: THREE.ShaderMaterial;
    cameraDensity: THREE.ShaderMaterial;
    cameraVelocity: THREE.ShaderMaterial;
  };

  constructor(width: number = 512, height: number = 512) {
    this._width = width;
    this._height = height;
    this.texelSizeX = 1.0 / width;
    this.texelSizeY = 1.0 / height;

    // Initialize simulation state
    this.velocity = new DoubleFBO(width, height);
    this.density = new DoubleFBO(width, height);
    this.pressure = new DoubleFBO(width, height);
    this.divergence = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
    });
    this.curl = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
    });

    // Default parameters
    this.params = {
      viscosity: 0.0001,
      vorticity: 30.0,
      dissipation: 0.98,
      velocityDissipation: 0.99,
      pressureIterations: 12,
      curl: 30.0,
    };

    this.renderParams = {
      intensity: 1.0,
      contrast: 1.0,
      saturation: 1.0,
      hueShift: 0.0,
      glow: 0.5,
      bgColor: [0, 0, 0] as [number, number, number],
    };

    this.mode = FLUID_MODES.SMOKE;

    // Setup scene
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // Create fullscreen quad
    const geometry = new THREE.PlaneGeometry(2, 2);
    this.quad = new THREE.Mesh(geometry);
    this.scene.add(this.quad);

    // Create shader materials
    const texelSize = new THREE.Vector2(this.texelSizeX, this.texelSizeY);

    this.materials = {
      advection: new THREE.ShaderMaterial({
        vertexShader: simpleVertexShader,
        fragmentShader: advectionShader,
        uniforms: {
          uVelocity: { value: null },
          uSource: { value: null },
          texelSize: { value: texelSize },
          dt: { value: 0.016 },
          dissipation: { value: this.params.dissipation },
        },
      }),

      divergence: new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader: divergenceShader,
        uniforms: {
          uVelocity: { value: null },
          texelSize: { value: texelSize },
        },
      }),

      curl: new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader: curlShader,
        uniforms: {
          uVelocity: { value: null },
          texelSize: { value: texelSize },
        },
      }),

      vorticity: new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader: vorticityShader,
        uniforms: {
          uVelocity: { value: null },
          uCurl: { value: null },
          curl: { value: this.params.curl },
          dt: { value: 0.016 },
          texelSize: { value: texelSize },
        },
      }),

      pressure: new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader: pressureShader,
        uniforms: {
          uPressure: { value: null },
          uDivergence: { value: null },
          texelSize: { value: texelSize },
        },
      }),

      gradientSubtract: new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader: gradientSubtractShader,
        uniforms: {
          uPressure: { value: null },
          uVelocity: { value: null },
          texelSize: { value: texelSize },
        },
      }),

      splat: new THREE.ShaderMaterial({
        vertexShader: simpleVertexShader,
        fragmentShader: splatShader,
        uniforms: {
          uTarget: { value: null },
          point: { value: new THREE.Vector2() },
          color: { value: new THREE.Vector3() },
          radius: { value: 0.001 },
          aspectRatio: { value: width / height },
        },
      }),

      clear: new THREE.ShaderMaterial({
        vertexShader: simpleVertexShader,
        fragmentShader: clearShader,
        uniforms: {
          value: { value: 0.0 },
        },
      }),

      display: new THREE.ShaderMaterial({
        vertexShader: simpleVertexShader,
        fragmentShader: displayShader,
        uniforms: {
          uDensity: { value: null },
          uVelocity: { value: null },
          mode: { value: this.mode },
          intensity: { value: this.renderParams.intensity },
          contrast: { value: this.renderParams.contrast },
          saturation: { value: this.renderParams.saturation },
          hueShift: { value: this.renderParams.hueShift },
          glow: { value: this.renderParams.glow },
          uBgColor: { value: new THREE.Vector3(0, 0, 0) },
        },
      }),

      cameraDensity: new THREE.ShaderMaterial({
        vertexShader: simpleVertexShader,
        fragmentShader: cameraDensityShader,
        uniforms: {
          uDensity: { value: null },
          uCamera: { value: null },
          uPrevCamera: { value: null },
          strength: { value: 3.0 },
          motionScale: { value: 8.0 },
        },
      }),

      cameraVelocity: new THREE.ShaderMaterial({
        vertexShader: simpleVertexShader,
        fragmentShader: cameraVelocityShader,
        uniforms: {
          uVelocity: { value: null },
          uCamera: { value: null },
          uPrevCamera: { value: null },
          strength: { value: 1.0 },
        },
      }),
    };
  }

  init(renderer: THREE.WebGLRenderer): void {
    // Clear all buffers
    this.clear(renderer);
  }

  resize(width: number, height: number): void {
    this._width = width;
    this._height = height;
    this.texelSizeX = 1.0 / width;
    this.texelSizeY = 1.0 / height;

    const texelSize = new THREE.Vector2(this.texelSizeX, this.texelSizeY);

    // Update all materials
    this.materials.advection.uniforms.texelSize.value = texelSize;
    this.materials.divergence.uniforms.texelSize.value = texelSize;
    this.materials.curl.uniforms.texelSize.value = texelSize;
    this.materials.vorticity.uniforms.texelSize.value = texelSize;
    this.materials.pressure.uniforms.texelSize.value = texelSize;
    this.materials.gradientSubtract.uniforms.texelSize.value = texelSize;
    this.materials.splat.uniforms.aspectRatio.value = width / height;

    // Resize buffers
    this.velocity.resize(width, height);
    this.density.resize(width, height);
    this.pressure.resize(width, height);
    this.divergence.setSize(width, height);
    this.curl.setSize(width, height);
  }

  step(renderer: THREE.WebGLRenderer, dt: number = 0.016): void {
    // Update time-dependent uniforms
    this.materials.advection.uniforms.dt.value = dt;
    this.materials.vorticity.uniforms.dt.value = dt;

    // 1. Calculate curl of velocity field
    this.materials.curl.uniforms.uVelocity.value = this.velocity.read.texture;
    this.quad.material = this.materials.curl;
    renderer.setRenderTarget(this.curl);
    renderer.render(this.scene, this.camera);

    // 2. Apply vorticity confinement
    this.materials.vorticity.uniforms.uVelocity.value = this.velocity.read.texture;
    this.materials.vorticity.uniforms.uCurl.value = this.curl.texture;
    this.quad.material = this.materials.vorticity;
    renderer.setRenderTarget(this.velocity.write);
    renderer.render(this.scene, this.camera);
    this.velocity.swap();

    // 3. Calculate divergence
    this.materials.divergence.uniforms.uVelocity.value = this.velocity.read.texture;
    this.quad.material = this.materials.divergence;
    renderer.setRenderTarget(this.divergence);
    renderer.render(this.scene, this.camera);

    // 4. Clear pressure
    this.materials.clear.uniforms.value.value = 0.0;
    this.quad.material = this.materials.clear;
    renderer.setRenderTarget(this.pressure.read);
    renderer.render(this.scene, this.camera);

    // 5. Solve for pressure (Jacobi iteration)
    this.materials.pressure.uniforms.uDivergence.value = this.divergence.texture;
    this.quad.material = this.materials.pressure;

    const pressureIterations = Math.max(1, Math.round(this.params.pressureIterations));
    for (let i = 0; i < pressureIterations; i++) {
      this.materials.pressure.uniforms.uPressure.value = this.pressure.read.texture;
      renderer.setRenderTarget(this.pressure.write);
      renderer.render(this.scene, this.camera);
      this.pressure.swap();
    }

    // 6. Subtract pressure gradient from velocity
    this.materials.gradientSubtract.uniforms.uPressure.value = this.pressure.read.texture;
    this.materials.gradientSubtract.uniforms.uVelocity.value = this.velocity.read.texture;
    this.quad.material = this.materials.gradientSubtract;
    renderer.setRenderTarget(this.velocity.write);
    renderer.render(this.scene, this.camera);
    this.velocity.swap();

    // 7. Advect velocity
    this.materials.advection.uniforms.uVelocity.value = this.velocity.read.texture;
    this.materials.advection.uniforms.uSource.value = this.velocity.read.texture;
    this.materials.advection.uniforms.dissipation.value = this.params.velocityDissipation;
    this.quad.material = this.materials.advection;
    renderer.setRenderTarget(this.velocity.write);
    renderer.render(this.scene, this.camera);
    this.velocity.swap();

    // 8. Advect density
    this.materials.advection.uniforms.uVelocity.value = this.velocity.read.texture;
    this.materials.advection.uniforms.uSource.value = this.density.read.texture;
    this.materials.advection.uniforms.dissipation.value = this.params.dissipation;
    this.quad.material = this.materials.advection;
    renderer.setRenderTarget(this.density.write);
    renderer.render(this.scene, this.camera);
    this.density.swap();
  }

  render(renderer: THREE.WebGLRenderer, target?: THREE.WebGLRenderTarget | null): void {
    this.materials.display.uniforms.uDensity.value = this.density.read.texture;
    this.materials.display.uniforms.uVelocity.value = this.velocity.read.texture;
    this.quad.material = this.materials.display;
    renderer.setRenderTarget(target || null);
    renderer.render(this.scene, this.camera);
  }

  applyForce(x: number, y: number, dx: number, dy: number, radius: number = 0.01): void {
    // Apply force to velocity
    this.materials.splat.uniforms.uTarget.value = this.velocity.read.texture;
    this.materials.splat.uniforms.point.value.set(x, y);
    this.materials.splat.uniforms.color.value.set(dx, dy, 0);
    this.materials.splat.uniforms.radius.value = radius;
    this.quad.material = this.materials.splat;

    // We need to render this in the next frame or use a temporary renderer reference
    // For now, we'll store the splat request
  }

  addDensity(
    renderer: THREE.WebGLRenderer,
    x: number,
    y: number,
    r: number,
    g: number,
    b: number,
    radius: number = 0.01
  ): void {
    this.materials.splat.uniforms.uTarget.value = this.density.read.texture;
    this.materials.splat.uniforms.point.value.set(x, y);
    this.materials.splat.uniforms.color.value.set(r, g, b);
    this.materials.splat.uniforms.radius.value = radius;
    this.quad.material = this.materials.splat;
    renderer.setRenderTarget(this.density.write);
    renderer.render(this.scene, this.camera);
    this.density.swap();
  }

  addVelocity(
    renderer: THREE.WebGLRenderer,
    x: number,
    y: number,
    dx: number,
    dy: number,
    radius: number = 0.01
  ): void {
    this.materials.splat.uniforms.uTarget.value = this.velocity.read.texture;
    this.materials.splat.uniforms.point.value.set(x, y);
    this.materials.splat.uniforms.color.value.set(dx, dy, 0);
    this.materials.splat.uniforms.radius.value = radius;
    this.quad.material = this.materials.splat;
    renderer.setRenderTarget(this.velocity.write);
    renderer.render(this.scene, this.camera);
    this.velocity.swap();
  }

  clear(renderer: THREE.WebGLRenderer): void {
    this.materials.clear.uniforms.value.value = 0.0;
    this.quad.material = this.materials.clear;

    renderer.setRenderTarget(this.velocity.read);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(this.velocity.write);
    renderer.render(this.scene, this.camera);

    renderer.setRenderTarget(this.density.read);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(this.density.write);
    renderer.render(this.scene, this.camera);

    renderer.setRenderTarget(this.pressure.read);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(this.pressure.write);
    renderer.render(this.scene, this.camera);

    renderer.setRenderTarget(null);
  }

  setMode(mode: FluidMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.materials.display.uniforms.mode.value = mode;
  }

  setParams(params: Partial<FluidSimulationParams>): void {
    const prev = this.params;
    const next = { ...prev, ...params };

    // Keep legacy/external naming in sync.
    if (params.vorticity !== undefined && params.curl === undefined) {
      next.curl = params.vorticity;
    }
    if (params.curl !== undefined && params.vorticity === undefined) {
      next.vorticity = params.curl;
    }

    const changed =
      next.viscosity !== prev.viscosity ||
      next.vorticity !== prev.vorticity ||
      next.dissipation !== prev.dissipation ||
      next.velocityDissipation !== prev.velocityDissipation ||
      next.pressureIterations !== prev.pressureIterations ||
      next.curl !== prev.curl;

    if (!changed) return;

    this.params = next;

    if (next.curl !== prev.curl) {
      this.materials.vorticity.uniforms.curl.value = next.curl;
    }
  }

  setRenderParams(params: Partial<FluidRenderParams>): void {
    const prev = this.renderParams;
    const next = { ...prev, ...params };
    const changed =
      next.intensity !== prev.intensity ||
      next.contrast !== prev.contrast ||
      next.saturation !== prev.saturation ||
      next.hueShift !== prev.hueShift ||
      next.glow !== prev.glow ||
      next.bgColor[0] !== prev.bgColor[0] ||
      next.bgColor[1] !== prev.bgColor[1] ||
      next.bgColor[2] !== prev.bgColor[2];
    if (!changed) return;

    this.renderParams = next;

    if (params.intensity !== undefined) {
      this.materials.display.uniforms.intensity.value = params.intensity;
    }
    if (params.contrast !== undefined) {
      this.materials.display.uniforms.contrast.value = params.contrast;
    }
    if (params.saturation !== undefined) {
      this.materials.display.uniforms.saturation.value = params.saturation;
    }
    if (params.hueShift !== undefined) {
      this.materials.display.uniforms.hueShift.value = params.hueShift;
    }
    if (params.glow !== undefined) {
      this.materials.display.uniforms.glow.value = params.glow;
    }
    if (params.bgColor !== undefined) {
      this.materials.display.uniforms.uBgColor.value.set(params.bgColor[0], params.bgColor[1], params.bgColor[2]);
    }
  }

  /**
   * Inject camera motion into fluid density and velocity buffers.
   * Uses frame differencing for motion detection.
   */
  injectCamera(
    renderer: THREE.WebGLRenderer,
    cameraTexture: THREE.Texture,
    prevCameraTexture: THREE.Texture,
    strength: number = 3.0
  ): void {
    // Inject density from camera motion
    this.materials.cameraDensity.uniforms.uDensity.value = this.density.read.texture;
    this.materials.cameraDensity.uniforms.uCamera.value = cameraTexture;
    this.materials.cameraDensity.uniforms.uPrevCamera.value = prevCameraTexture;
    this.materials.cameraDensity.uniforms.strength.value = strength;
    this.quad.material = this.materials.cameraDensity;
    renderer.setRenderTarget(this.density.write);
    renderer.render(this.scene, this.camera);
    this.density.swap();

    // Inject velocity from camera motion
    this.materials.cameraVelocity.uniforms.uVelocity.value = this.velocity.read.texture;
    this.materials.cameraVelocity.uniforms.uCamera.value = cameraTexture;
    this.materials.cameraVelocity.uniforms.uPrevCamera.value = prevCameraTexture;
    this.materials.cameraVelocity.uniforms.strength.value = strength;
    this.quad.material = this.materials.cameraVelocity;
    renderer.setRenderTarget(this.velocity.write);
    renderer.render(this.scene, this.camera);
    this.velocity.swap();
  }

  getTexture(): THREE.Texture {
    return this.density.read.texture;
  }

  dispose(): void {
    this.velocity.dispose();
    this.density.dispose();
    this.pressure.dispose();
    this.divergence.dispose();
    this.curl.dispose();

    Object.values(this.materials).forEach(material => material.dispose());
    this.quad.geometry.dispose();
  }
}
