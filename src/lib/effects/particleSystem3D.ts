/**
 * ParticleSystem3D — Integrated Three.js 3D particle engine
 *
 * Premium PBR materials (chrome, glass, neon, wireframe, soft), orbiting spotlights,
 * bloom post-processing, GPU-instanced rendering.
 * TENDRILS mode: actual growing 3D tube geometry (vine-like).
 * 5 color modes, image/video texture support, connector lines.
 * Follows the same API pattern as FluidSimulation for Canvas.svelte integration.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export type ParticleMode = 0 | 1 | 2 | 3; // SPHERES, TENDRILS, VOXELS, POINTCLOUD

export interface ParticleParams {
  mode: ParticleMode;
  count: number;
  size: number;
  speed: number;
  gravity: number;
  turbulence: number;
  vortex: number;
  drag: number;
  mouseForce: number;
  mouseRadius: number;
  emission: number;
  bloom: number;
  bloomThreshold: number;
  material: number; // 0=Chrome 1=Glass 2=Neon 3=Wire 4=Soft
  colorA: [number, number, number];
  colorB: [number, number, number];
  colorC: [number, number, number];
  colorMode: number; // 0=Tri-color 1=Rainbow 2=Monochrome 3=Temperature 4=Pulse
  connectors: boolean;
  connectorDist: number;
  connectorOpacity: number;
  lightCount: number;
  lightIntensity: number;
  lightOrbitSpeed: number;
  lightColorA: [number, number, number];
  lightColorB: [number, number, number];
  lightConeAngle: number;
  ambient: number;
  autoRotate: boolean;
  rotationSpeed: number;
  textureUrl: string; // blob URL for image/video texture (empty = none)
}

const DEFAULT_PARAMS: ParticleParams = {
  mode: 0,
  count: 3000,
  size: 0.8,
  speed: 2.0,
  gravity: -0.5,
  turbulence: 2.0,
  vortex: 1.0,
  drag: 0.98,
  mouseForce: 50.0,
  mouseRadius: 15.0,
  emission: 2.0,
  bloom: 0.6,
  bloomThreshold: 0.35,
  material: 0,
  colorA: [0.2, 0.5, 1.0],
  colorB: [1.0, 0.3, 0.8],
  colorC: [0.3, 1.0, 0.5],
  colorMode: 0,
  connectors: false,
  connectorDist: 5,
  connectorOpacity: 0.4,
  lightCount: 3,
  lightIntensity: 4.0,
  lightOrbitSpeed: 0.5,
  lightColorA: [0.3, 0.5, 1.0],
  lightColorB: [1.0, 0.3, 0.6],
  lightConeAngle: 0.6,
  ambient: 0.35,
  autoRotate: true,
  rotationSpeed: 0.15,
  textureUrl: '',
};

// ─── Particle data (SoA layout for cache-friendly physics) ──────────────────

interface ParticleData {
  px: Float32Array;
  py: Float32Array;
  pz: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  vz: Float32Array;
  scale: Float32Array;
  colorIndex: Uint8Array;
  life: Float32Array;
}

// ─── Tendril data ───────────────────────────────────────────────────────────

interface Tendril {
  points: THREE.Vector3[];
  headVel: THREE.Vector3;
  colorIdx: number;
  radius: number;
  maxPoints: number;
  mesh: THREE.Mesh | null;
  age: number;
  rebuildCounter: number; // throttle geometry rebuilds
}

// ─── Environment Map Generator ──────────────────────────────────────────────

function createEnvMap(): THREE.CubeTexture {
  const size = 128;
  const images: HTMLCanvasElement[] = [];
  const faceColors = [
    [[40, 20, 60], [80, 30, 120]],
    [[10, 30, 80], [20, 60, 140]],
    [[20, 10, 40], [60, 20, 100]],
    [[5, 5, 15], [10, 10, 30]],
    [[30, 15, 50], [60, 25, 90]],
    [[15, 25, 60], [30, 50, 120]],
  ];
  for (let face = 0; face < 6; face++) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createLinearGradient(0, 0, 0, size);
    const [r1, g1, b1] = faceColors[face][0];
    const [r2, g2, b2] = faceColors[face][1];
    grad.addColorStop(0, `rgb(${r1},${g1},${b1})`);
    grad.addColorStop(1, `rgb(${r2},${g2},${b2})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    for (let s = 0; s < 5; s++) {
      const sx = Math.random() * size;
      const sy = Math.random() * size;
      const sr = 5 + Math.random() * 20;
      const spotGrad = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
      spotGrad.addColorStop(0, 'rgba(200,180,255,0.4)');
      spotGrad.addColorStop(1, 'rgba(200,180,255,0)');
      ctx.fillStyle = spotGrad;
      ctx.fillRect(0, 0, size, size);
    }
    images.push(canvas);
  }
  const cubeTexture = new THREE.CubeTexture(images);
  cubeTexture.needsUpdate = true;
  return cubeTexture;
}

// ─── Material Factory ───────────────────────────────────────────────────────

function createMaterial(
  type: number,
  color: THREE.Color,
  emission: number,
  envMap: THREE.CubeTexture | null,
  texture: THREE.Texture | null,
): THREE.Material {
  const mapProps = texture ? { map: texture } : {};
  switch (type) {
    case 0: // CHROME
      return new THREE.MeshPhysicalMaterial({
        color, emissive: color, emissiveIntensity: emission * 0.3,
        metalness: 1.0, roughness: 0.05, reflectivity: 1.0,
        clearcoat: 1.0, clearcoatRoughness: 0.05,
        envMap, envMapIntensity: 2.5, ...mapProps,
      });
    case 1: // GLASS
      return new THREE.MeshPhysicalMaterial({
        color, emissive: color, emissiveIntensity: emission * 0.5,
        metalness: 0.0, roughness: 0.0, transparent: true, opacity: 0.3,
        transmission: 0.9, thickness: 1.5, ior: 1.8, reflectivity: 0.9,
        clearcoat: 1.0, clearcoatRoughness: 0.0,
        envMap, envMapIntensity: 1.5, side: THREE.DoubleSide, depthWrite: false,
        ...mapProps,
      });
    case 2: // NEON
      return new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(0x000000), emissive: color,
        emissiveIntensity: emission * 3.0,
        metalness: 0.0, roughness: 1.0, clearcoat: 0.3, clearcoatRoughness: 0.8,
        ...mapProps,
      });
    case 3: // WIRE
      return new THREE.MeshPhysicalMaterial({
        color, emissive: color, emissiveIntensity: emission * 1.5,
        metalness: 0.8, roughness: 0.2, wireframe: true,
        envMap, envMapIntensity: 1.0,
      });
    case 4: // SOFT
      return new THREE.MeshPhysicalMaterial({
        color, emissive: color, emissiveIntensity: emission * 0.15,
        metalness: 0.0, roughness: 0.85, clearcoat: 0.2, clearcoatRoughness: 0.8,
        sheen: 1.0, sheenRoughness: 0.6,
        sheenColor: color.clone().lerp(new THREE.Color(1, 1, 1), 0.3),
        envMap, envMapIntensity: 0.4, ...mapProps,
      });
    default:
      return new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: emission, ...mapProps });
  }
}

// ─── Color Mode Helpers ─────────────────────────────────────────────────────

const _tempColor = new THREE.Color();
const _hsl = { h: 0, s: 0, l: 0 };

function getParticleColor(
  mode: number,
  index: number, count: number, time: number,
  vx: number, vy: number, vz: number,
  colorA: THREE.Color, colorB: THREE.Color, colorC: THREE.Color,
  out: THREE.Color,
): void {
  switch (mode) {
    case 0: // Tri-color
      if (index % 3 === 0) out.copy(colorA);
      else if (index % 3 === 1) out.copy(colorB);
      else out.copy(colorC);
      break;
    case 1: // Rainbow
      out.setHSL(((index / count) + time * 0.05) % 1.0, 0.85, 0.55);
      break;
    case 2: // Monochrome
    {
      const brightness = 0.4 + (index / count) * 0.6;
      out.copy(colorA).multiplyScalar(brightness);
      break;
    }
    case 3: // Temperature (velocity-based)
    {
      const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
      const t = Math.min(speed / 5.0, 1.0);
      // Blue → White → Orange
      if (t < 0.5) {
        out.setRGB(t * 2, t * 2, 1.0); // blue → white
      } else {
        const t2 = (t - 0.5) * 2;
        out.setRGB(1.0, 1.0 - t2 * 0.5, 1.0 - t2); // white → orange
      }
      break;
    }
    case 4: // Pulse (cycle A→B→C over time)
    {
      const phase = (time * 0.3) % 3;
      if (phase < 1) out.copy(colorA).lerp(colorB, phase);
      else if (phase < 2) out.copy(colorB).lerp(colorC, phase - 1);
      else out.copy(colorC).lerp(colorA, phase - 2);
      break;
    }
    default:
      out.copy(colorA);
  }
}

// ─── Main Class ─────────────────────────────────────────────────────────────

export class ParticleSystem3D {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private instancedMesh: THREE.InstancedMesh | null = null;
  private activeMaterial: THREE.Material | null = null;
  private geometry: THREE.BufferGeometry | null = null;
  private lights: THREE.SpotLight[] = [];
  private ambientLight: THREE.AmbientLight;
  private hemisphereLight: THREE.HemisphereLight;
  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private renderPass: RenderPass | null = null;
  private envMap: THREE.CubeTexture | null = null;

  private particles: ParticleData | null = null;
  private dummy = new THREE.Matrix4();

  // Tendril state
  private tendrils: Tendril[] = [];
  private tendrilGroup: THREE.Group | null = null;
  private tendrilMaterials: THREE.Material[] = []; // 3 shared materials (one per color)
  private tendrilFrameCounter = 0;

  // Connector lines
  private connectorLines: THREE.LineSegments | null = null;
  private connectorGeometry: THREE.BufferGeometry | null = null;
  private connectorMaterial: THREE.LineBasicMaterial | null = null;
  private connectorPositions: Float32Array | null = null;
  private connectorColors: Float32Array | null = null;

  // Texture
  private userTexture: THREE.Texture | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private currentTextureUrl = '';

  private params: ParticleParams = { ...DEFAULT_PARAMS };
  private currentCount = 0;
  private currentMaterialType = -1;
  private time = 0;
  private cameraAngle = 0;
  private cameraDistance = 40;
  private cameraPitch = 0.3;

  // Mouse interaction (UV 0..1)
  private mouseX = 0.5;
  private mouseY = 0.5;
  private mouseActive = false;

  public width: number;
  public height: number;
  private initialized = false;

  constructor(width = 1920, height = 1080) {
    this.width = width;
    this.height = height;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x010108);
    this.scene.fog = new THREE.FogExp2(0x010108, 0.012);

    this.camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 500);
    this.camera.position.set(0, 10, 40);
    this.camera.lookAt(0, 0, 0);

    this.ambientLight = new THREE.AmbientLight(0x303050, 0.15);
    this.scene.add(this.ambientLight);

    this.hemisphereLight = new THREE.HemisphereLight(0x4060a0, 0x201020, 0.3);
    this.scene.add(this.hemisphereLight);
  }

  init(renderer: THREE.WebGLRenderer): void {
    if (this.initialized) return;

    this.envMap = createEnvMap();
    this.scene.environment = this.envMap;

    // 3 spotlights
    const lightColors = [0x4488ff, 0xff44aa, 0x44ffaa];
    for (let i = 0; i < 3; i++) {
      const light = new THREE.SpotLight(lightColors[i], 4.0, 120, this.params.lightConeAngle, 0.5, 1);
      light.visible = i < this.params.lightCount;
      light.castShadow = false;
      light.target.position.set(0, 0, 0);
      this.scene.add(light);
      this.scene.add(light.target);
      this.lights.push(light);
    }

    // Bloom composer
    const renderTarget = new THREE.WebGLRenderTarget(this.width, this.height, {
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
    });
    this.composer = new EffectComposer(renderer, renderTarget);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(this.width, this.height),
      this.params.bloom, 0.4, this.params.bloomThreshold,
    );
    this.composer.addPass(this.bloomPass);

    this.spawnParticles(this.params.count, this.params.mode);
    this.initialized = true;
  }

  // ── Texture Management ──────────────────────────────────────────────────

  private updateTexture(url: string): void {
    if (url === this.currentTextureUrl) return;
    this.currentTextureUrl = url;

    // Dispose old
    if (this.userTexture) {
      this.userTexture.dispose();
      this.userTexture = null;
    }
    if (this.videoElement) {
      this.videoElement.pause();
      this.videoElement.src = '';
      this.videoElement = null;
    }

    if (!url) {
      // Force material rebuild without texture
      this.currentMaterialType = -1;
      return;
    }

    // Detect video vs image by trying video first
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    video.src = url;

    video.addEventListener('loadeddata', () => {
      this.videoElement = video;
      video.play();
      this.userTexture = new THREE.VideoTexture(video);
      this.userTexture.minFilter = THREE.LinearFilter;
      this.userTexture.magFilter = THREE.LinearFilter;
      this.userTexture.colorSpace = THREE.SRGBColorSpace;
      this.currentMaterialType = -1; // force material rebuild
    }, { once: true });

    video.addEventListener('error', () => {
      // Not a video — try as image
      const loader = new THREE.TextureLoader();
      loader.load(url, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        this.userTexture = tex;
        this.currentMaterialType = -1;
      });
    }, { once: true });
  }

  // ── Material Management ─────────────────────────────────────────────────

  private createOrUpdateMaterial(): THREE.Material {
    const p = this.params;
    if (this.activeMaterial && this.currentMaterialType === p.material) {
      const mat = this.activeMaterial as THREE.MeshPhysicalMaterial;
      if (mat.emissive) {
        mat.emissiveIntensity = p.material === 2 ? p.emission * 3.0 :
                                 p.material === 3 ? p.emission * 1.5 :
                                 p.material === 1 ? p.emission * 0.5 :
                                 p.material === 4 ? p.emission * 0.15 :
                                 p.emission * 0.3;
      }
      return this.activeMaterial;
    }

    if (this.activeMaterial) this.activeMaterial.dispose();

    const baseColor = new THREE.Color(...p.colorA);
    this.activeMaterial = createMaterial(p.material, baseColor, p.emission, this.envMap, this.userTexture);
    this.currentMaterialType = p.material;

    if (this.instancedMesh) {
      this.instancedMesh.material = this.activeMaterial;
    }
    return this.activeMaterial;
  }

  // ── Particle Spawning ───────────────────────────────────────────────────

  private spawnParticles(count: number, mode: ParticleMode): void {
    if (this.instancedMesh) {
      this.scene.remove(this.instancedMesh);
      this.instancedMesh.dispose();
      this.instancedMesh = null;
    }
    if (this.geometry) {
      this.geometry.dispose();
      this.geometry = null;
    }
    this.disposeConnectors();
    this.disposeTendrils();

    this.currentCount = count;

    if (mode === 1) {
      this.spawnTendrils();
      return;
    }

    if (mode === 2) {
      this.geometry = new THREE.BoxGeometry(1, 1, 1, 2, 2, 2);
    } else if (mode === 3) {
      this.geometry = new THREE.SphereGeometry(0.5, 8, 6);
    } else {
      this.geometry = new THREE.SphereGeometry(0.5, 24, 16);
    }

    const mat = this.createOrUpdateMaterial();
    this.instancedMesh = new THREE.InstancedMesh(this.geometry, mat, count);
    this.instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.instancedMesh.castShadow = true;
    this.instancedMesh.receiveShadow = true;

    const colorAttr = new Float32Array(count * 3);
    this.instancedMesh.instanceColor = new THREE.InstancedBufferAttribute(colorAttr, 3);
    this.instancedMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.instancedMesh);

    this.particles = {
      px: new Float32Array(count), py: new Float32Array(count), pz: new Float32Array(count),
      vx: new Float32Array(count), vy: new Float32Array(count), vz: new Float32Array(count),
      scale: new Float32Array(count), colorIndex: new Uint8Array(count), life: new Float32Array(count),
    };

    for (let i = 0; i < count; i++) {
      this.particles.life[i] = 1.0;
      this.particles.scale[i] = 0.5 + Math.random() * 0.5;
      this.particles.colorIndex[i] = i % 3;

      switch (mode) {
        case 0: {
          const theta = Math.random() * Math.PI * 2;
          const phi = Math.acos(2 * Math.random() - 1);
          const r = 8 * Math.cbrt(Math.random());
          this.particles.px[i] = r * Math.sin(phi) * Math.cos(theta);
          this.particles.py[i] = r * Math.sin(phi) * Math.sin(theta);
          this.particles.pz[i] = r * Math.cos(phi);
          break;
        }
        case 2: {
          const gridSize = 16;
          const gi = i % (gridSize * gridSize * gridSize);
          this.particles.px[i] = (gi % gridSize - gridSize / 2) * 1.0;
          this.particles.py[i] = (Math.floor(gi / gridSize) % gridSize - gridSize / 2) * 1.0;
          this.particles.pz[i] = (Math.floor(gi / (gridSize * gridSize)) - gridSize / 2) * 1.0;
          break;
        }
        case 3: {
          const res = 64;
          this.particles.px[i] = ((i % res) / res - 0.5) * 30;
          this.particles.py[i] = 0;
          this.particles.pz[i] = (Math.floor(i / res) % res / res - 0.5) * 30;
          break;
        }
      }
      this.particles.vx[i] = (Math.random() - 0.5) * 0.5;
      this.particles.vy[i] = (Math.random() - 0.5) * 0.5;
      this.particles.vz[i] = (Math.random() - 0.5) * 0.5;
    }
  }

  // ── Tendril Spawning & Update ─────────────────────────────────────────────

  private spawnTendrils(): void {
    this.tendrilGroup = new THREE.Group();
    this.scene.add(this.tendrilGroup);
    this.tendrils = [];

    const numTendrils = Math.max(12, Math.min(80, Math.floor(this.params.count / 50)));

    // Create 3 shared materials (one per color) — NEVER clone per frame
    this.disposeTendrilMaterials();
    const colors = [
      new THREE.Color(...this.params.colorA),
      new THREE.Color(...this.params.colorB),
      new THREE.Color(...this.params.colorC),
    ];
    for (let c = 0; c < 3; c++) {
      const mat = createMaterial(this.params.material, colors[c], this.params.emission, this.envMap, this.userTexture);
      this.tendrilMaterials.push(mat);
    }

    for (let i = 0; i < numTendrils; i++) {
      const startType = Math.random();
      let startPos: THREE.Vector3;
      if (startType < 0.4) {
        startPos = new THREE.Vector3((Math.random() - 0.5) * 16, -8 + Math.random() * 2, (Math.random() - 0.5) * 16);
      } else if (startType < 0.7) {
        startPos = new THREE.Vector3((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4);
      } else {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const r = 5 + Math.random() * 5;
        startPos = new THREE.Vector3(r * Math.sin(phi) * Math.cos(theta), r * Math.sin(phi) * Math.sin(theta), r * Math.cos(phi));
      }

      const dir = new THREE.Vector3(
        (Math.random() - 0.5) * 2, 0.5 + Math.random() * 2, (Math.random() - 0.5) * 2,
      ).normalize().multiplyScalar(0.3 + Math.random() * 0.4);

      this.tendrils.push({
        points: [startPos.clone()],
        headVel: dir,
        colorIdx: i % 3,
        radius: 0.08 + Math.random() * 0.2,
        maxPoints: 40 + Math.floor(Math.random() * 80),
        mesh: null,
        age: Math.random() * 5,
        rebuildCounter: Math.floor(Math.random() * 3), // stagger rebuilds
      });
    }
  }

  private updateTendrils(dt: number): void {
    if (!this.tendrilGroup) return;

    const p = this.params;
    const mouseWorldX = (this.mouseX - 0.5) * 60;
    const mouseWorldZ = (this.mouseY - 0.5) * 60;

    // Update shared material emissive intensity (no clone, no new materials)
    for (let c = 0; c < this.tendrilMaterials.length; c++) {
      const mat = this.tendrilMaterials[c] as THREE.MeshPhysicalMaterial;
      if (mat.emissive) {
        mat.emissiveIntensity = p.material === 2 ? p.emission * 3.0 :
                                 p.material === 3 ? p.emission * 1.5 :
                                 p.material === 1 ? p.emission * 0.5 :
                                 p.material === 4 ? p.emission * 0.15 :
                                 p.emission * 0.3;
      }
    }

    this.tendrilFrameCounter++;

    for (const tendril of this.tendrils) {
      tendril.age += dt;
      const head = tendril.points[tendril.points.length - 1];

      // Physics on the tip
      const turbScale = p.turbulence * 0.15;
      tendril.headVel.x += Math.sin(head.y * 0.4 + this.time * 1.3) * turbScale * dt;
      tendril.headVel.y += Math.cos(head.z * 0.4 + this.time * 1.1) * turbScale * dt;
      tendril.headVel.z += Math.sin(head.x * 0.4 + this.time * 0.9) * turbScale * dt;

      tendril.headVel.y += p.gravity * 0.05 * dt;

      if (p.vortex > 0) {
        const vs = p.vortex * 0.03 * dt;
        tendril.headVel.x += -head.z * vs;
        tendril.headVel.z += head.x * vs;
      }

      // Mouse attraction — strong, with 3D attraction
      if (this.mouseActive && p.mouseForce > 0) {
        const mdx = mouseWorldX - head.x;
        const mdy = 0 - head.y;
        const mdz = mouseWorldZ - head.z;
        const mdist = Math.sqrt(mdx * mdx + mdy * mdy + mdz * mdz);
        if (mdist < p.mouseRadius * 2 && mdist > 0.1) {
          const force = p.mouseForce * 0.08 * dt * (1 - mdist / (p.mouseRadius * 2));
          tendril.headVel.x += (mdx / mdist) * force;
          tendril.headVel.y += (mdy / mdist) * force * 0.5;
          tendril.headVel.z += (mdz / mdist) * force;
        }
      }

      tendril.headVel.multiplyScalar(0.995);
      const speed = tendril.headVel.length();
      const maxSpeed = p.speed * 0.8;
      if (speed > maxSpeed) tendril.headVel.multiplyScalar(maxSpeed / speed);

      // Grow point
      const growRate = 0.08 + p.speed * 0.02;
      if (tendril.age > 0) {
        const lastPoint = tendril.points[tendril.points.length - 1];
        const newPoint = lastPoint.clone().add(tendril.headVel.clone().multiplyScalar(growRate));
        if (tendril.points.length < tendril.maxPoints) {
          tendril.points.push(newPoint);
        } else {
          tendril.points.shift();
          tendril.points.push(newPoint);
        }
      }

      // Only rebuild tube geometry every 3 frames (massive perf improvement)
      tendril.rebuildCounter++;
      if (tendril.points.length >= 3 && tendril.rebuildCounter >= 3) {
        tendril.rebuildCounter = 0;

        // Dispose old geometry only
        if (tendril.mesh) {
          this.tendrilGroup.remove(tendril.mesh);
          tendril.mesh.geometry.dispose();
          // Material is shared — do NOT dispose
        }

        const curve = new THREE.CatmullRomCurve3(tendril.points, false, 'centripetal', 0.5);
        const baseRadius = tendril.radius * p.size;
        const segments = Math.min(tendril.points.length * 2, 150);
        const radialSegments = 5;
        const tubeGeo = new THREE.TubeGeometry(curve, segments, baseRadius, radialSegments, false);

        // Taper the tube
        const posAttr = tubeGeo.getAttribute('position');
        const totalVerts = posAttr.count;
        const vertsPerRing = radialSegments + 1;
        const numRings = Math.floor(totalVerts / vertsPerRing);

        for (let ring = 0; ring < numRings; ring++) {
          const t = ring / Math.max(numRings - 1, 1);
          const taper = (1.0 - t * 0.7) * (1.0 + 0.15 * Math.sin(t * 10 + tendril.age));
          const curveT = Math.min(t, 1);
          const center = curve.getPointAt(curveT);

          for (let rv = 0; rv < vertsPerRing; rv++) {
            const idx = ring * vertsPerRing + rv;
            if (idx >= totalVerts) break;
            const vx = posAttr.getX(idx);
            const vy = posAttr.getY(idx);
            const vz = posAttr.getZ(idx);
            posAttr.setXYZ(idx,
              center.x + (vx - center.x) * taper,
              center.y + (vy - center.y) * taper,
              center.z + (vz - center.z) * taper,
            );
          }
        }
        posAttr.needsUpdate = true;
        tubeGeo.computeVertexNormals();

        // Use shared material — no cloning
        const mat = this.tendrilMaterials[tendril.colorIdx % this.tendrilMaterials.length];
        tendril.mesh = new THREE.Mesh(tubeGeo, mat);
        tendril.mesh.castShadow = true;
        this.tendrilGroup.add(tendril.mesh);
      }
    }
  }

  private disposeTendrilMaterials(): void {
    for (const mat of this.tendrilMaterials) mat.dispose();
    this.tendrilMaterials = [];
  }

  private disposeTendrils(): void {
    for (const tendril of this.tendrils) {
      if (tendril.mesh) {
        tendril.mesh.geometry.dispose();
        // Do NOT dispose material — shared via tendrilMaterials
      }
    }
    this.tendrils = [];
    this.disposeTendrilMaterials();
    if (this.tendrilGroup) {
      this.scene.remove(this.tendrilGroup);
      this.tendrilGroup = null;
    }
  }

  private disposeConnectors(): void {
    if (this.connectorLines) this.scene.remove(this.connectorLines);
    if (this.connectorGeometry) { this.connectorGeometry.dispose(); this.connectorGeometry = null; }
    if (this.connectorMaterial) { this.connectorMaterial.dispose(); this.connectorMaterial = null; }
    this.connectorLines = null;
    this.connectorPositions = null;
    this.connectorColors = null;
  }

  // ── Physics Step ────────────────────────────────────────────────────────

  step(renderer: THREE.WebGLRenderer, dt: number = 0.016): void {
    const p = this.params;
    this.time += dt;

    // Handle texture changes
    this.updateTexture(p.textureUrl);

    // TENDRILS MODE
    if (p.mode === 1) {
      this.updateTendrils(dt);
      this.updateLightsAndCamera(dt);
      return;
    }

    // PARTICLE MODES
    if (!this.particles || !this.instancedMesh) return;

    const n = this.currentCount;
    const { px, py, pz, vx, vy, vz, scale } = this.particles;

    const mat = this.createOrUpdateMaterial();
    if (this.instancedMesh.material !== mat) this.instancedMesh.material = mat;

    const mouseWorldX = (this.mouseX - 0.5) * 60;
    const mouseWorldZ = (this.mouseY - 0.5) * 60;

    for (let i = 0; i < n; i++) {
      vy[i] += p.gravity * dt;

      const dist = Math.sqrt(px[i] * px[i] + py[i] * py[i] + pz[i] * pz[i]);
      if (dist > 1) {
        const attraction = 0.1 * p.speed;
        vx[i] -= (px[i] / dist) * attraction * dt;
        vy[i] -= (py[i] / dist) * attraction * dt;
        vz[i] -= (pz[i] / dist) * attraction * dt;
      }

      const turbScale = p.turbulence * dt;
      vx[i] += Math.sin(py[i] * 0.3 + this.time * 1.3) * turbScale;
      vy[i] += Math.cos(pz[i] * 0.3 + this.time * 1.1) * turbScale;
      vz[i] += Math.sin(px[i] * 0.3 + this.time * 0.9) * turbScale;

      if (p.vortex > 0) {
        const vs = p.vortex * dt;
        vx[i] += -pz[i] * 0.01 * vs;
        vz[i] += px[i] * 0.01 * vs;
      }

      if (this.mouseActive && p.mouseForce > 0) {
        const mdx = px[i] - mouseWorldX;
        const mdz = pz[i] - mouseWorldZ;
        const mdist = Math.sqrt(mdx * mdx + mdz * mdz);
        if (mdist < p.mouseRadius && mdist > 0.1) {
          const force = p.mouseForce * dt * (1 - mdist / p.mouseRadius);
          vx[i] += (mdx / mdist) * force;
          vz[i] += (mdz / mdist) * force;
          vy[i] += force * 0.5;
        }
      }

      vx[i] *= p.drag;
      vy[i] *= p.drag;
      vz[i] *= p.drag;

      px[i] += vx[i] * dt * p.speed;
      py[i] += vy[i] * dt * p.speed;
      pz[i] += vz[i] * dt * p.speed;

      if (dist > 50) {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const r = 3 * Math.cbrt(Math.random());
        px[i] = r * Math.sin(phi) * Math.cos(theta);
        py[i] = r * Math.sin(phi) * Math.sin(theta);
        pz[i] = r * Math.cos(phi);
        vx[i] = vy[i] = vz[i] = 0;
      }

      if (p.mode === 2) {
        py[i] += Math.sin(px[i] * 0.5 + this.time * 3) * 0.5 * dt * 2;
      } else if (p.mode === 3) {
        py[i] = Math.sin(px[i] * 0.2 + pz[i] * 0.2 + this.time * 2) * 3;
      }
    }

    // Update instance matrices + colors
    const colorA = new THREE.Color(...p.colorA);
    const colorB = new THREE.Color(...p.colorB);
    const colorC = new THREE.Color(...p.colorC);
    const outColor = new THREE.Color();

    const matrix = this.dummy;
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scaleVec = new THREE.Vector3();

    for (let i = 0; i < n; i++) {
      position.set(px[i], py[i], pz[i]);
      scaleVec.setScalar(p.size * scale[i]);
      matrix.compose(position, quaternion, scaleVec);
      this.instancedMesh.setMatrixAt(i, matrix);

      getParticleColor(p.colorMode, i, n, this.time, vx[i], vy[i], vz[i], colorA, colorB, colorC, outColor);
      this.instancedMesh.setColorAt(i, outColor);
    }

    this.instancedMesh.instanceMatrix.needsUpdate = true;
    if (this.instancedMesh.instanceColor) {
      this.instancedMesh.instanceColor.needsUpdate = true;
    }

    // Connector lines
    this.updateConnectors(p, n, px, py, pz, colorA, colorB, colorC);
    this.updateLightsAndCamera(dt);
  }

  private updateConnectors(
    p: ParticleParams, n: number,
    px: Float32Array, py: Float32Array, pz: Float32Array,
    colorA: THREE.Color, colorB: THREE.Color, colorC: THREE.Color,
  ): void {
    if (!p.connectors) {
      if (this.connectorLines) {
        this.scene.remove(this.connectorLines);
        this.connectorGeometry?.dispose();
        this.connectorMaterial?.dispose();
        this.connectorLines = null;
        this.connectorGeometry = null;
        this.connectorMaterial = null;
      }
      return;
    }

    const maxDist = p.connectorDist;
    const maxDistSq = maxDist * maxDist;
    const searchN = Math.min(n, 1500);
    const maxLines = 20000;

    if (!this.connectorPositions || this.connectorPositions.length < maxLines * 6) {
      this.connectorPositions = new Float32Array(maxLines * 6);
      this.connectorColors = new Float32Array(maxLines * 6);
    }

    let lineCount = 0;
    const positions = this.connectorPositions;
    const lineColors = this.connectorColors!;
    const colors = [colorA, colorB, colorC];
    const stride = searchN > 800 ? 3 : searchN > 400 ? 2 : 1;

    for (let i = 0; i < searchN && lineCount < maxLines; i += stride) {
      for (let j = i + 1; j < searchN && lineCount < maxLines; j += stride) {
        const dx = px[i] - px[j];
        const dy = py[i] - py[j];
        const dz = pz[i] - pz[j];
        const distSq = dx * dx + dy * dy + dz * dz;
        if (distSq < maxDistSq) {
          const idx = lineCount * 6;
          positions[idx] = px[i]; positions[idx + 1] = py[i]; positions[idx + 2] = pz[i];
          positions[idx + 3] = px[j]; positions[idx + 4] = py[j]; positions[idx + 5] = pz[j];
          const alpha = 1 - Math.sqrt(distSq) / maxDist;
          const ci = colors[i % 3], cj = colors[j % 3];
          lineColors[idx] = ci.r * alpha; lineColors[idx + 1] = ci.g * alpha; lineColors[idx + 2] = ci.b * alpha;
          lineColors[idx + 3] = cj.r * alpha; lineColors[idx + 4] = cj.g * alpha; lineColors[idx + 5] = cj.b * alpha;
          lineCount++;
        }
      }
    }

    if (!this.connectorGeometry) {
      this.connectorGeometry = new THREE.BufferGeometry();
      this.connectorMaterial = new THREE.LineBasicMaterial({
        vertexColors: true, transparent: true, opacity: p.connectorOpacity,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      this.connectorLines = new THREE.LineSegments(this.connectorGeometry, this.connectorMaterial);
      this.scene.add(this.connectorLines);
    }

    // Reuse buffer attributes instead of creating new ones each frame
    const posAttr = this.connectorGeometry.getAttribute('position') as THREE.BufferAttribute | null;
    if (!posAttr || posAttr.array.length < lineCount * 6) {
      this.connectorGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      this.connectorGeometry.setAttribute('color', new THREE.BufferAttribute(lineColors, 3));
    } else {
      (posAttr.array as Float32Array).set(positions.subarray(0, lineCount * 6));
      posAttr.needsUpdate = true;
      const colAttr = this.connectorGeometry.getAttribute('color') as THREE.BufferAttribute;
      (colAttr.array as Float32Array).set(lineColors.subarray(0, lineCount * 6));
      colAttr.needsUpdate = true;
    }
    this.connectorGeometry.setDrawRange(0, lineCount * 2);

    if (this.connectorMaterial) this.connectorMaterial.opacity = p.connectorOpacity;
  }

  private updateLightsAndCamera(dt: number): void {
    const p = this.params;

    for (let i = 0; i < this.lights.length; i++) {
      this.lights[i].visible = i < p.lightCount;
      if (i < p.lightCount) {
        const angle = (i / Math.max(p.lightCount, 1)) * Math.PI * 2 + this.time * p.lightOrbitSpeed * (1 + i * 0.2);
        const heightVar = Math.sin(this.time * 0.25 + i * 2.1) * 6;
        const orbitRadius = 18 + Math.sin(this.time * 0.15 + i * 1.7) * 6;
        this.lights[i].position.set(Math.cos(angle) * orbitRadius, 12 + heightVar, Math.sin(angle) * orbitRadius);
        this.lights[i].intensity = p.lightIntensity;
        this.lights[i].angle = p.lightConeAngle;
        this.lights[i].penumbra = 0.5;
        this.lights[i].distance = 120;
        const targetDrift = Math.sin(this.time * 0.4 + i) * 3;
        this.lights[i].target.position.set(targetDrift, 0, targetDrift * 0.5);
        const tintColor = i % 2 === 0 ? p.lightColorA : p.lightColorB;
        this.lights[i].color.setRGB(tintColor[0], tintColor[1], tintColor[2]);
      }
    }

    this.ambientLight.intensity = p.ambient * 0.5;
    this.hemisphereLight.intensity = p.ambient;

    if (this.bloomPass) {
      this.bloomPass.strength = p.bloom;
      this.bloomPass.threshold = p.bloomThreshold;
    }

    if (p.autoRotate) this.cameraAngle += p.rotationSpeed * dt;
    this.camera.position.set(
      Math.cos(this.cameraAngle) * this.cameraDistance * Math.cos(this.cameraPitch),
      Math.sin(this.cameraPitch) * this.cameraDistance * 0.5 + 5,
      Math.sin(this.cameraAngle) * this.cameraDistance * Math.cos(this.cameraPitch),
    );
    this.camera.lookAt(0, 0, 0);
  }

  // ── Render ──────────────────────────────────────────────────────────────

  private blitScene: THREE.Scene | null = null;
  private blitCamera: THREE.OrthographicCamera | null = null;
  private blitMesh: THREE.Mesh | null = null;
  private blitMaterial: THREE.MeshBasicMaterial | null = null;

  private ensureBlit(): void {
    if (!this.blitScene) {
      this.blitScene = new THREE.Scene();
      this.blitCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      this.blitMaterial = new THREE.MeshBasicMaterial();
      this.blitMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blitMaterial);
      this.blitScene.add(this.blitMesh);
    }
  }

  render(renderer: THREE.WebGLRenderer, target?: THREE.WebGLRenderTarget | null): void {
    if (!this.composer) return;

    if (target) {
      if (this.composer.renderTarget1.width !== target.width ||
          this.composer.renderTarget1.height !== target.height) {
        this.composer.setSize(target.width, target.height);
      }
    }

    this.composer.render();

    if (target) {
      this.ensureBlit();
      // Use readBuffer — this is the actual output of the last pass
      this.blitMaterial!.map = this.composer.readBuffer.texture;
      this.blitMaterial!.needsUpdate = true;
      const prevTarget = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      renderer.clear();
      renderer.render(this.blitScene!, this.blitCamera!);
      renderer.setRenderTarget(prevTarget);
    }
  }

  renderToTarget(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget): void {
    this.render(renderer, target);
  }

  // ── Parameter Setters ───────────────────────────────────────────────────

  setParams(params: Partial<ParticleParams>): void {
    const oldMode = this.params.mode;
    const oldCount = this.params.count;
    const oldMaterial = this.params.material;

    // Only apply changed values
    let changed = false;
    for (const key of Object.keys(params) as Array<keyof ParticleParams>) {
      const newVal = params[key];
      if (newVal === undefined) continue;
      const oldVal = this.params[key];
      // Deep compare arrays
      if (Array.isArray(newVal) && Array.isArray(oldVal)) {
        if ((newVal as number[]).some((v, i) => v !== (oldVal as number[])[i])) {
          (this.params as any)[key] = newVal;
          changed = true;
        }
      } else if (newVal !== oldVal) {
        (this.params as any)[key] = newVal;
        changed = true;
      }
    }

    if (!changed) return;

    // Respawn only if mode or count actually changed
    if (this.initialized && (this.params.mode !== oldMode || this.params.count !== oldCount)) {
      this.spawnParticles(this.params.count, this.params.mode);
    }

    if (this.params.material !== oldMaterial) {
      this.currentMaterialType = -1; // force material rebuild
    }
  }

  setMouse(x: number, y: number, active: boolean): void {
    this.mouseX = x;
    this.mouseY = y;
    this.mouseActive = active;
  }

  getTexture(): THREE.Texture | null {
    // Return readBuffer texture — matches what render() outputs
    return this.composer?.readBuffer?.texture ?? null;
  }

  // ── Resize ──────────────────────────────────────────────────────────────

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    if (this.composer) this.composer.setSize(width, height);
    if (this.bloomPass) this.bloomPass.resolution.set(width, height);
  }

  // ── Dispose ─────────────────────────────────────────────────────────────

  dispose(): void {
    if (this.instancedMesh) { this.scene.remove(this.instancedMesh); this.instancedMesh.dispose(); }
    if (this.geometry) this.geometry.dispose();
    if (this.activeMaterial) this.activeMaterial.dispose();
    this.disposeTendrils();
    this.disposeConnectors();
    this.lights.forEach(l => { this.scene.remove(l); this.scene.remove(l.target); l.dispose(); });
    this.scene.remove(this.ambientLight);
    this.scene.remove(this.hemisphereLight);
    if (this.envMap) this.envMap.dispose();
    if (this.userTexture) this.userTexture.dispose();
    if (this.videoElement) { this.videoElement.pause(); this.videoElement.src = ''; }
    if (this.composer) {
      // Dispose internal render targets
      this.composer.renderTarget1?.dispose();
      this.composer.renderTarget2?.dispose();
      this.composer.dispose();
    }
    if (this.blitMesh) { this.blitMesh.geometry.dispose(); this.blitMaterial?.dispose(); }
    this.blitScene = null;
    this.blitCamera = null;
    this.blitMesh = null;
    this.blitMaterial = null;
    this.initialized = false;
  }
}
