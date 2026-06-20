import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { loadPLY } from '../splat';
import type { OutputSlice } from '../stores/settings';
import type {
  ProjectionSimGizmoMode,
  ProjectionSimObject,
  ProjectionSimProjector,
  ProjectionSimScene,
  ProjectionSimSelection,
} from './types';

const MAX_PROJECTORS = 4;
const IDENTITY = new THREE.Matrix4();
const DEFAULT_CROP = new THREE.Vector4(0, 0, 1, 1);
const ZERO_BLEND = new THREE.Vector4(0, 0, 0, 0);
const WHITE = new THREE.Vector3(1, 1, 1);
const DEPTH_BIAS = 0.0018;
const SCRATCH_COLOR = new THREE.Color();
const LOOK_AT_MATRIX = new THREE.Matrix4();

type ProjectionMaterial = THREE.MeshStandardMaterial & {
  userData: THREE.MeshStandardMaterial['userData'] & {
    projectionShader?: any;
  };
};

export interface ProjectionSimTransformPatch {
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
  target?: [number, number, number];
}

interface ProjectorRenderData {
  camera: THREE.PerspectiveCamera;
  matrix: THREE.Matrix4;
  position: THREE.Vector3;
  crop: THREE.Vector4;
  blend: THREE.Vector4;
  tint: THREE.Vector3;
  opacity: number;
  intensity: number;
  depthTexture: THREE.Texture | null;
}

interface LoadedModelData {
  scene: THREE.Object3D;
  animations: THREE.AnimationClip[];
}

interface MultiTransformItem {
  target: NonNullable<ProjectionSimSelection>;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
  projectorTarget?: THREE.Vector3;
}

interface MultiTransformSnapshot {
  matrixInverse: THREE.Matrix4;
  quaternionInverse: THREE.Quaternion;
  scale: THREE.Vector3;
  items: MultiTransformItem[];
}

function vec3(v: [number, number, number]): THREE.Vector3 {
  return new THREE.Vector3(v[0], v[1], v[2]);
}

function arr3(v: THREE.Vector3): [number, number, number] {
  return [round(v.x), round(v.y), round(v.z)];
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function setColorVec3(target: THREE.Vector3, color: string): void {
  SCRATCH_COLOR.set(color || '#ffffff');
  target.set(SCRATCH_COLOR.r, SCRATCH_COLOR.g, SCRATCH_COLOR.b);
}

function resolveSurfaceColor(object: ProjectionSimObject, style: ProjectionSimScene['environment']['surfaceStyle'] | undefined): string {
  switch (style) {
    case 'white': return '#f2f0e8';
    case 'dark-gray': return '#3c4047';
    case 'light-gray': return '#cfd3d6';
    case 'original':
    default:
      return object.color || '#c8c2b7';
  }
}

function objectStructureHash(scene: ProjectionSimScene): string {
  return JSON.stringify({
    env: {
      ambient: scene.environment.ambient,
      floorColor: scene.environment.floorColor,
      showGrid: scene.environment.showGrid,
      surfaceStyle: scene.environment.surfaceStyle,
    },
    objects: scene.objects.map((obj) => ({
      id: obj.id,
      type: obj.type,
      primitive: obj.primitive,
      color: obj.color,
      roughness: obj.roughness,
      visible: obj.visible,
      receiveProjection: obj.receiveProjection,
      castShadow: obj.castShadow,
      assetUrl: obj.assetUrl,
      assetName: obj.assetName,
      assetFormat: obj.assetFormat,
      pointSize: obj.pointSize,
    })),
    projectors: scene.projectors.map((p) => ({
      id: p.id,
      color: p.color,
      fov: p.fov,
      aspect: p.aspect,
      showFrustum: p.showFrustum,
    })),
  });
}

function projectorDepthHash(scene: ProjectionSimScene): string {
  return JSON.stringify({
    objects: scene.objects.map((obj) => ({
      id: obj.id,
      type: obj.type,
      primitive: obj.primitive,
      visible: obj.visible,
      position: obj.position,
      rotation: obj.rotation,
      scale: obj.scale,
      assetUrl: obj.assetUrl,
      assetFormat: obj.assetFormat,
      pointSize: obj.pointSize,
    })),
    projectors: scene.projectors
      .filter((projector) => projector.enabled)
      .slice(0, MAX_PROJECTORS)
      .map((projector) => ({
        id: projector.id,
        position: projector.position,
        target: projector.target,
        fov: projector.fov,
        aspect: projector.aspect,
      })),
  });
}

function makeProjectionMaterial(
  object: ProjectionSimObject,
  surfaceStyle: ProjectionSimScene['environment']['surfaceStyle'] | undefined,
  sourceMaterial?: THREE.Material | null,
): ProjectionMaterial {
  const sourceStandard = sourceMaterial && (sourceMaterial as THREE.MeshStandardMaterial).isMeshStandardMaterial
    ? sourceMaterial as THREE.MeshStandardMaterial
    : null;
  const useOriginal = surfaceStyle === 'original';
  const material = new THREE.MeshStandardMaterial({
    color: sourceStandard && useOriginal
      ? sourceStandard.color.clone()
      : new THREE.Color(resolveSurfaceColor(object, surfaceStyle)),
    roughness: sourceStandard && useOriginal ? sourceStandard.roughness : object.roughness ?? 0.82,
    metalness: sourceStandard && useOriginal ? sourceStandard.metalness : 0.02,
  }) as ProjectionMaterial;

  if (sourceStandard) {
    if (useOriginal || sourceStandard.transparent || sourceStandard.alphaTest > 0) {
      material.map = sourceStandard.map;
    }
    if (useOriginal) {
      material.roughnessMap = sourceStandard.roughnessMap;
      material.metalnessMap = sourceStandard.metalnessMap;
      material.aoMap = sourceStandard.aoMap;
      material.emissiveMap = sourceStandard.emissiveMap;
      material.emissive.copy(sourceStandard.emissive);
      material.emissiveIntensity = sourceStandard.emissiveIntensity;
    }
    material.normalMap = sourceStandard.normalMap;
    material.normalScale.copy(sourceStandard.normalScale);
    material.alphaMap = sourceStandard.alphaMap;
    material.transparent = sourceStandard.transparent || Boolean(sourceStandard.alphaMap);
    material.opacity = sourceStandard.opacity;
    material.alphaTest = sourceStandard.alphaTest || (sourceStandard.alphaMap ? 0.35 : 0);
    material.side = sourceStandard.side;
  }

  if (!object.receiveProjection) return material;

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uProjectionTexture = { value: null };
    shader.uniforms.uProjectorCount = { value: 0 };
    shader.uniforms.uProjectorMatrices = { value: Array.from({ length: MAX_PROJECTORS }, () => IDENTITY.clone()) };
    shader.uniforms.uProjectorPositions = { value: Array.from({ length: MAX_PROJECTORS }, () => new THREE.Vector3()) };
    shader.uniforms.uProjectorCrops = { value: Array.from({ length: MAX_PROJECTORS }, () => DEFAULT_CROP.clone()) };
    shader.uniforms.uProjectorBlends = { value: Array.from({ length: MAX_PROJECTORS }, () => ZERO_BLEND.clone()) };
    shader.uniforms.uProjectorTints = { value: Array.from({ length: MAX_PROJECTORS }, () => WHITE.clone()) };
    shader.uniforms.uProjectorOpacities = { value: new Array(MAX_PROJECTORS).fill(0) };
    shader.uniforms.uProjectorIntensities = { value: new Array(MAX_PROJECTORS).fill(1) };
    shader.uniforms.uProjectorDepth0 = { value: null };
    shader.uniforms.uProjectorDepth1 = { value: null };
    shader.uniforms.uProjectorDepth2 = { value: null };
    shader.uniforms.uProjectorDepth3 = { value: null };
    shader.uniforms.uProjectorDepthBias = { value: DEPTH_BIAS };
    shader.uniforms.uProjectorShadowStrength = { value: 1 };

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vProjectionWorldPosition;\nvarying vec3 vProjectionWorldNormal;')
      .replace('#include <skinnormal_vertex>', '#include <skinnormal_vertex>\nvProjectionWorldNormal = normalize(mat3(modelMatrix) * objectNormal);')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
vec4 psimWorldPosition = vec4(transformed, 1.0);
#ifdef USE_BATCHING
  psimWorldPosition = batchingMatrix * psimWorldPosition;
#endif
#ifdef USE_INSTANCING
  psimWorldPosition = instanceMatrix * psimWorldPosition;
#endif
psimWorldPosition = modelMatrix * psimWorldPosition;
vProjectionWorldPosition = psimWorldPosition.xyz;`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
#include <packing>
uniform sampler2D uProjectionTexture;
uniform int uProjectorCount;
uniform mat4 uProjectorMatrices[${MAX_PROJECTORS}];
uniform vec3 uProjectorPositions[${MAX_PROJECTORS}];
uniform vec4 uProjectorCrops[${MAX_PROJECTORS}];
uniform vec4 uProjectorBlends[${MAX_PROJECTORS}];
uniform vec3 uProjectorTints[${MAX_PROJECTORS}];
uniform float uProjectorOpacities[${MAX_PROJECTORS}];
uniform float uProjectorIntensities[${MAX_PROJECTORS}];
uniform sampler2D uProjectorDepth0;
uniform sampler2D uProjectorDepth1;
uniform sampler2D uProjectorDepth2;
uniform sampler2D uProjectorDepth3;
uniform float uProjectorDepthBias;
uniform float uProjectorShadowStrength;
varying vec3 vProjectionWorldPosition;
varying vec3 vProjectionWorldNormal;

float psimEdgeFade(vec2 uv, vec4 blend) {
  float l = blend.x <= 0.0001 ? 1.0 : smoothstep(0.0, blend.x, uv.x);
  float r = blend.y <= 0.0001 ? 1.0 : smoothstep(0.0, blend.y, 1.0 - uv.x);
  float t = blend.z <= 0.0001 ? 1.0 : smoothstep(0.0, blend.z, uv.y);
  float b = blend.w <= 0.0001 ? 1.0 : smoothstep(0.0, blend.w, 1.0 - uv.y);
  return clamp(min(min(l, r), min(t, b)), 0.0, 1.0);
}

float psimDepthAt(int index, vec2 uv) {
  if (index == 0) return unpackRGBAToDepth(texture2D(uProjectorDepth0, uv));
  if (index == 1) return unpackRGBAToDepth(texture2D(uProjectorDepth1, uv));
  if (index == 2) return unpackRGBAToDepth(texture2D(uProjectorDepth2, uv));
  return unpackRGBAToDepth(texture2D(uProjectorDepth3, uv));
}
`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
vec3 psimSurfaceColor = diffuseColor.rgb;
vec3 psimProjectedLight = vec3(0.0);
for (int i = 0; i < ${MAX_PROJECTORS}; i++) {
  if (i >= uProjectorCount) break;
  vec4 p = uProjectorMatrices[i] * vec4(vProjectionWorldPosition, 1.0);
  vec3 ndc = p.xyz / max(0.0001, p.w);
  vec2 uv = ndc.xy * 0.5 + 0.5;
  float projectedDepth = ndc.z * 0.5 + 0.5;
  float sceneDepth = psimDepthAt(i, uv);
  float occlusionVisibility = step(projectedDepth - uProjectorDepthBias, sceneDepth);
  float visibleFromProjector = mix(1.0, occlusionVisibility, clamp(uProjectorShadowStrength, 0.0, 1.0));
  float inside = step(0.0, p.w)
    * step(-1.0, ndc.x) * step(ndc.x, 1.0)
    * step(-1.0, ndc.y) * step(ndc.y, 1.0)
    * step(-1.0, ndc.z) * step(ndc.z, 1.0);
  vec4 crop = uProjectorCrops[i];
  vec2 croppedUv = crop.xy + uv * crop.zw;
  vec3 projected = texture2D(uProjectionTexture, croppedUv).rgb;
  float edge = psimEdgeFade(uv, uProjectorBlends[i]);
  float facingProjector = smoothstep(
    0.01,
    0.08,
    dot(normalize(vProjectionWorldNormal), normalize(uProjectorPositions[i] - vProjectionWorldPosition))
  );
  float w = inside * visibleFromProjector * facingProjector * edge * uProjectorOpacities[i];
  psimProjectedLight += projected * uProjectorTints[i] * uProjectorIntensities[i] * w;
}
float psimReflectance = clamp(max(max(psimSurfaceColor.r, psimSurfaceColor.g), psimSurfaceColor.b), 0.45, 1.0);
totalEmissiveRadiance += psimProjectedLight * psimReflectance;
`);

    material.userData.projectionShader = shader;
  };

  return material;
}

export class ProjectionSimulatorRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(48, 16 / 9, 0.05, 200);
  private controls: OrbitControls;
  private transformControls: TransformControls;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private root = new THREE.Group();
  private projectorRoot = new THREE.Group();
  private grid: THREE.GridHelper | null = null;
  private roomHemi = new THREE.HemisphereLight('#f4efe4', '#10131a', 0.32);
  private selectionOutline = new THREE.BoxHelper(new THREE.Object3D(), '#ff725f');
  private multiTransformGroup = new THREE.Group();
  private multiSelectionBox = new THREE.Box3Helper(new THREE.Box3(), '#ff725f');
  private transformHelper: THREE.Object3D;
  private depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  private depthTargets: THREE.WebGLRenderTarget[] = [];
  private whiteDepthTexture: THREE.DataTexture;
  private sourceTexture: THREE.CanvasTexture | null = null;
  private sourceCanvas: HTMLCanvasElement | null = null;
  private lastHash = '';
  private lastDepthHash = '';
  private lastShadowHash = '';
  private selectable = new Map<string, THREE.Object3D>();
  private projectionMaterials: ProjectionMaterial[] = [];
  private projectors: ProjectorRenderData[] = [];
  private projectorDataById = new Map<string, ProjectorRenderData>();
  private projectorLights = new Map<string, { light: THREE.SpotLight; target: THREE.Object3D }>();
  private uniformMatrices = Array.from({ length: MAX_PROJECTORS }, () => IDENTITY.clone());
  private uniformPositions = Array.from({ length: MAX_PROJECTORS }, () => new THREE.Vector3());
  private uniformCrops = Array.from({ length: MAX_PROJECTORS }, () => DEFAULT_CROP.clone());
  private uniformBlends = Array.from({ length: MAX_PROJECTORS }, () => ZERO_BLEND.clone());
  private uniformTints = Array.from({ length: MAX_PROJECTORS }, () => WHITE.clone());
  private uniformOpacities = new Array(MAX_PROJECTORS).fill(0);
  private uniformIntensities = new Array(MAX_PROJECTORS).fill(1);
  private uniformDepths: Array<THREE.Texture | null> = new Array(MAX_PROJECTORS).fill(null);
  private projectorShadowStrength = 1;
  private selected: ProjectionSimSelection = null;
  private selectedTargets: NonNullable<ProjectionSimSelection>[] = [];
  private attachedSelection: ProjectionSimSelection | '__multi__' = null;
  private multiTransformStart: MultiTransformSnapshot | null = null;
  private currentGizmoMode: ProjectionSimGizmoMode = 'translate';
  private currentScene: ProjectionSimScene | null = null;
  private modelCache = new Map<string, Promise<LoadedModelData>>();
  private animationMixers: THREE.AnimationMixer[] = [];
  private animationClock = new THREE.Clock();
  private lastAnimationDepthRefresh = 0;
  private pickProjectors = false;
  private transformDragging = false;
  private pointerDown: { x: number; y: number } | null = null;
  private raf = 0;
  private recordingMode = false;
  private onSelect: (target: ProjectionSimSelection, event?: PointerEvent) => void;
  private onTransform: (target: ProjectionSimSelection, patch: ProjectionSimTransformPatch) => void;

  constructor(
    private canvas: HTMLCanvasElement,
    opts: {
      onSelect: (target: ProjectionSimSelection, event?: PointerEvent) => void;
      onTransform: (target: ProjectionSimSelection, patch: ProjectionSimTransformPatch) => void;
    },
  ) {
    this.onSelect = opts.onSelect;
    this.onTransform = opts.onTransform;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;

    this.camera.position.set(9, 6, 11);
    this.camera.lookAt(0, 2, 0);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 2, 0);

    this.transformControls = new TransformControls(this.camera, canvas);
    this.transformControls.addEventListener('dragging-changed', (event: any) => {
      this.transformDragging = !!event.value;
      this.controls.enabled = !event.value;
      if (event.value && this.attachedSelection === '__multi__') {
        this.multiTransformStart = this.captureMultiTransformStart();
      } else if (!event.value && this.attachedSelection === '__multi__') {
        this.multiTransformStart = null;
        this.updateMultiTransformGroup();
      }
    });
    this.transformControls.addEventListener('objectChange', () => this.publishTransform());
    this.transformHelper = (this.transformControls as any).getHelper?.() ?? (this.transformControls as any);
    this.scene.add(this.transformHelper);

    this.scene.add(this.root);
    this.scene.add(this.projectorRoot);
    this.multiTransformGroup.userData.projectionSimPickable = false;
    this.multiTransformGroup.visible = false;
    this.scene.add(this.multiTransformGroup);
    this.scene.add(this.roomHemi);
    this.selectionOutline.visible = false;
    this.selectionOutline.userData.projectionSimPickable = false;
    this.scene.add(this.selectionOutline);
    this.multiSelectionBox.visible = false;
    this.multiSelectionBox.userData.projectionSimPickable = false;
    this.scene.add(this.multiSelectionBox);

    this.whiteDepthTexture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
    this.whiteDepthTexture.needsUpdate = true;

    canvas.addEventListener('pointerdown', this.handlePointerDown, { passive: true });
    canvas.addEventListener('pointerup', this.handlePointerUp, { passive: true });
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    this.canvas.removeEventListener('pointerup', this.handlePointerUp);
    this.transformControls.detach();
    this.controls.dispose();
    (this.transformControls as any).dispose?.();
    this.clearGroup(this.root);
    this.clearGroup(this.projectorRoot);
    this.projectorLights.clear();
    this.sourceTexture?.dispose();
    this.depthMaterial.dispose();
    this.selectionOutline.geometry.dispose();
    (this.selectionOutline.material as THREE.Material).dispose();
    this.multiSelectionBox.geometry.dispose();
    (this.multiSelectionBox.material as THREE.Material).dispose();
    for (const target of this.depthTargets) target.dispose();
    this.whiteDepthTexture.dispose();
    this.renderer.dispose();
  }

  setGizmoMode(mode: ProjectionSimGizmoMode): void {
    this.currentGizmoMode = mode;
    this.transformControls.setMode(mode);
  }

  setPickProjectors(enabled: boolean): void {
    this.pickProjectors = enabled;
  }

  setSelection(target: ProjectionSimSelection): void {
    this.selected = target;
    if (target && !this.selectedTargets.includes(target)) this.selectedTargets = [target];
    if (!target) this.selectedTargets = [];
    this.refreshSelectionAttachment();
  }

  setSelections(targets: ProjectionSimSelection[]): void {
    const next = [...new Set(targets.filter(Boolean) as NonNullable<ProjectionSimSelection>[])];
    this.selectedTargets = next;
    if (this.selected && !next.includes(this.selected)) this.selected = next[next.length - 1] ?? null;
    if (!this.selected && next.length) this.selected = next[next.length - 1];
    this.refreshSelectionAttachment();
  }

  private refreshSelectionAttachment(): void {
    const transformableTargets = this.getTransformableSelectedTargets();
    if (transformableTargets.length > 1) {
      this.updateMultiTransformGroup(transformableTargets);
      if (this.attachedSelection !== '__multi__') {
        this.transformControls.attach(this.multiTransformGroup);
        this.attachedSelection = '__multi__';
      }
      return;
    }

    if (!this.selected || !transformableTargets.length) {
      this.transformControls.detach();
      this.attachedSelection = null;
      this.multiTransformGroup.visible = false;
      return;
    }

    const singleTarget = transformableTargets[0];
    const obj = this.selectable.get(singleTarget);
    if (!obj || !obj.visible || this.isTargetLocked(singleTarget)) {
      this.transformControls.detach();
      this.attachedSelection = null;
      this.multiTransformGroup.visible = false;
      return;
    }

    this.multiTransformGroup.visible = false;
    if (this.attachedSelection === singleTarget) return;
    this.transformControls.attach(obj);
    this.attachedSelection = singleTarget;
  }

  private getTransformableSelectedTargets(): NonNullable<ProjectionSimSelection>[] {
    const source = this.selectedTargets.length
      ? this.selectedTargets
      : (this.selected ? [this.selected] : []);
    return source.filter((target) => {
      const obj = this.selectable.get(target);
      return Boolean(obj?.visible) && !this.isTargetLocked(target);
    }) as NonNullable<ProjectionSimSelection>[];
  }

  private isTargetLocked(target: ProjectionSimSelection): boolean {
    if (!target || !this.currentScene) return false;
    const [kind, id] = target.split(':') as ['object' | 'projector', string];
    if (kind === 'object') return this.currentScene.objects.find((object) => object.id === id)?.locked ?? false;
    return this.currentScene.projectors.find((projector) => projector.id === id)?.locked ?? false;
  }

  private getSelectionBox(targets: NonNullable<ProjectionSimSelection>[]): THREE.Box3 | null {
    const box = new THREE.Box3();
    let hasBox = false;
    for (const target of targets) {
      const obj = this.selectable.get(target);
      if (!obj || !obj.visible) continue;
      obj.updateMatrixWorld(true);
      box.expandByObject(obj);
      hasBox = true;
    }
    return hasBox ? box : null;
  }

  private updateMultiTransformGroup(targets = this.getTransformableSelectedTargets()): void {
    if (this.transformDragging) return;
    const box = this.getSelectionBox(targets);
    if (!box) {
      this.multiTransformGroup.visible = false;
      return;
    }
    const center = box.getCenter(new THREE.Vector3());
    this.multiTransformGroup.position.copy(center);
    this.multiTransformGroup.rotation.set(0, 0, 0);
    this.multiTransformGroup.scale.set(1, 1, 1);
    this.multiTransformGroup.visible = true;
    this.multiTransformGroup.updateMatrixWorld(true);
  }

  private captureMultiTransformStart(): MultiTransformSnapshot | null {
    const targets = this.getTransformableSelectedTargets();
    if (targets.length <= 1) return null;
    this.multiTransformGroup.updateMatrixWorld(true);
    const items: MultiTransformItem[] = [];
    for (const target of targets) {
      const obj = this.selectable.get(target);
      if (!obj) continue;
      const item: MultiTransformItem = {
        target,
        position: obj.position.clone(),
        quaternion: obj.quaternion.clone(),
        scale: obj.scale.clone(),
      };
      if (target.startsWith('projector:')) {
        const id = target.slice('projector:'.length);
        const projector = this.currentScene?.projectors.find((p) => p.id === id);
        item.projectorTarget = projector ? vec3(projector.target) : obj.position.clone().add(new THREE.Vector3(0, 0, -5).applyQuaternion(obj.quaternion));
      }
      items.push(item);
    }
    if (items.length <= 1) return null;
    return {
      matrixInverse: this.multiTransformGroup.matrixWorld.clone().invert(),
      quaternionInverse: this.multiTransformGroup.quaternion.clone().invert(),
      scale: this.multiTransformGroup.scale.clone(),
      items,
    };
  }

  frameCamera(): void {
    this.controls.target.set(0, 2.3, 0);
    this.camera.position.set(9, 6, 11);
    this.camera.lookAt(this.controls.target);
    this.controls.update();
  }

  topCamera(): void {
    this.controls.target.set(0, 0, 0);
    this.camera.position.set(0.01, 18, 0.01);
    this.camera.lookAt(0, 0, 0);
    this.controls.update();
  }

  beginRecording(width = 1920, height = 1080): HTMLCanvasElement {
    this.recordingMode = true;
    this.resize(width, height, true);
    return this.canvas;
  }

  endRecording(): void {
    this.recordingMode = false;
    this.resize(undefined, undefined, true);
  }

  render(sceneState: ProjectionSimScene, sourceCanvas: HTMLCanvasElement | null, outputSlices: OutputSlice[]): void {
    this.currentScene = sceneState;
    this.resize();
    this.updateSourceTexture(sourceCanvas);

    const hash = objectStructureHash(sceneState);
    if (hash !== this.lastHash) {
      this.lastHash = hash;
      this.rebuild(sceneState);
    }

    const depthHash = projectorDepthHash(sceneState);
    this.syncCamera(sceneState);
    this.syncTransforms(sceneState);
    this.refreshSelectionAttachment();
    this.updateSelectionOutline();
    this.updateProjectorData(sceneState, outputSlices);
    this.updateImportedAnimations();
    this.renderProjectorDepthMaps(depthHash);
    this.updateProjectionUniforms();
    this.updateShadowDirtyState(sceneState, depthHash);

    this.controls.update();
    this.renderMainScene();
  }

  private renderMainScene(): void {
    if (!this.recordingMode) {
      this.renderer.render(this.scene, this.camera);
      return;
    }

    const hidden: THREE.Object3D[] = [];
    const hide = (object: THREE.Object3D | null | undefined) => {
      if (!object?.visible) return;
      object.visible = false;
      hidden.push(object);
    };
    hide(this.transformHelper);
    hide(this.selectionOutline);
    hide(this.multiSelectionBox);
    this.projectorRoot.traverse((child) => {
      if (child.userData.projectionSimBeam) hide(child);
    });

    this.renderer.render(this.scene, this.camera);

    for (const object of hidden) object.visible = true;
  }

  private resize(width?: number, height?: number, force = false): void {
    const targetW = width ?? Math.max(1, Math.floor(this.canvas.clientWidth || 1280));
    const targetH = height ?? Math.max(1, Math.floor(this.canvas.clientHeight || 720));
    const size = new THREE.Vector2();
    this.renderer.getSize(size);
    if (!force && size.x === targetW && size.y === targetH) return;
    this.renderer.setSize(targetW, targetH, false);
    this.camera.aspect = targetW / Math.max(1, targetH);
    this.camera.updateProjectionMatrix();
  }

  private updateSourceTexture(canvas: HTMLCanvasElement | null): void {
    if (!canvas) return;
    if (this.sourceCanvas !== canvas || !this.sourceTexture) {
      this.sourceTexture?.dispose();
      this.sourceCanvas = canvas;
      this.sourceTexture = new THREE.CanvasTexture(canvas);
      this.sourceTexture.colorSpace = THREE.SRGBColorSpace;
      this.sourceTexture.minFilter = THREE.LinearFilter;
      this.sourceTexture.magFilter = THREE.LinearFilter;
      this.sourceTexture.wrapS = THREE.ClampToEdgeWrapping;
      this.sourceTexture.wrapT = THREE.ClampToEdgeWrapping;
      this.sourceTexture.generateMipmaps = false;
      this.sourceTexture.flipY = true;
    }
    this.sourceTexture.needsUpdate = canvas.width > 0 && canvas.height > 0;
  }

  private syncCamera(sceneState: ProjectionSimScene): void {
    this.scene.background = new THREE.Color(sceneState.environment.background);
    this.projectorShadowStrength = sceneState.environment.shadows
      ? THREE.MathUtils.clamp(sceneState.environment.shadowStrength ?? 1, 0, 1)
      : 0;
    this.renderer.shadowMap.enabled = this.projectorShadowStrength > 0;
    const roomExposure = sceneState.environment.roomExposure ?? 1.15;
    this.renderer.toneMappingExposure = roomExposure;
    this.roomHemi.intensity = 0.18 + roomExposure * 0.18;
    this.camera.fov = sceneState.camera.fov;
    this.camera.updateProjectionMatrix();
  }

  private rebuild(sceneState: ProjectionSimScene): void {
    this.transformControls.detach();
    this.attachedSelection = null;
    this.disposeProjectorLights();
    this.clearGroup(this.root);
    this.clearGroup(this.projectorRoot);
    this.selectable.clear();
    this.projectionMaterials = [];
    this.animationMixers = [];
    this.animationClock.getDelta();
    this.lastDepthHash = '';
    this.lastShadowHash = '';

    const ambient = new THREE.AmbientLight('#ffffff', sceneState.environment.ambient);
    this.root.add(ambient);

    const floorReceiver: ProjectionSimObject = {
      id: 'projection-floor',
      name: 'Projection floor',
      type: 'primitive',
      primitive: 'plane',
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [80, 80, 1],
      color: sceneState.environment.floorColor,
      roughness: 0.9,
      visible: true,
      locked: true,
      castShadow: false,
      receiveProjection: true,
    };
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 80),
      makeProjectionMaterial(floorReceiver, 'original'),
    );
    floor.name = 'Projection floor';
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    floor.castShadow = false;
    this.prepareProjectedObject(floor, floorReceiver);
    this.root.add(floor);

    if (sceneState.environment.showGrid) {
      this.grid = new THREE.GridHelper(40, 40, '#495060', '#252a34');
      this.grid.position.y = 0.01;
      this.root.add(this.grid);
    } else {
      this.grid = null;
    }

    for (const object of sceneState.objects) {
      const built = this.buildObject(object);
      this.root.add(built);
      this.selectable.set(`object:${object.id}`, built);
    }

    for (const projector of sceneState.projectors) {
      const built = this.buildProjector(projector);
      this.projectorRoot.add(built);
      this.selectable.set(`projector:${projector.id}`, built);
    }

    this.setSelection(this.selected);
  }

  private buildObject(object: ProjectionSimObject): THREE.Object3D {
    const group = new THREE.Group();
    group.name = object.name;
    group.userData.projectionSimTarget = `object:${object.id}`;

    if (object.type === 'primitive') {
      group.add(this.buildPrimitiveMesh(object));
    } else if (object.type === 'pointcloud') {
      group.add(this.buildImportPlaceholder(object, 'Point cloud loading...'));
      void this.loadPointCloud(object, group);
    } else {
      group.add(this.buildImportPlaceholder(object, 'Model loading...'));
      void this.loadModel(object, group);
    }

    this.applyObjectTransform(group, object);
    return group;
  }

  private buildPrimitiveMesh(object: ProjectionSimObject): THREE.Object3D {
    const kind = object.primitive ?? 'box';
    const surfaceStyle = this.currentScene?.environment.surfaceStyle;
    if (kind === 'column') {
      const column = new THREE.Group();
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 1, 32), makeProjectionMaterial(object, surfaceStyle));
      const capTop = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.16, 1.05), makeProjectionMaterial({ ...object, color: '#ded8c8' }, surfaceStyle));
      const capBottom = capTop.clone();
      shaft.position.y = 0;
      capTop.position.y = 0.58;
      capBottom.position.y = -0.58;
      column.add(shaft, capTop, capBottom);
      this.prepareProjectedObject(column, object);
      return column;
    }

    let geometry: THREE.BufferGeometry;
    switch (kind) {
      case 'sphere':
        geometry = new THREE.SphereGeometry(0.5, 48, 24);
        break;
      case 'cylinder':
        geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 40);
        break;
      case 'cone':
        geometry = new THREE.ConeGeometry(0.55, 1, 40);
        break;
      case 'pyramid':
        geometry = new THREE.ConeGeometry(0.75, 1, 4);
        geometry.rotateY(Math.PI / 4);
        break;
      case 'plane':
        geometry = new THREE.BoxGeometry(1, 1, 0.06);
        break;
      case 'box':
      default:
        geometry = new THREE.BoxGeometry(1, 1, 1);
    }

    const mesh = new THREE.Mesh(geometry, makeProjectionMaterial(object, surfaceStyle));
    this.prepareProjectedObject(mesh, object);
    return mesh;
  }

  private prepareProjectedObject(object3d: THREE.Object3D, object: ProjectionSimObject): void {
    object3d.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = object.castShadow;
      mesh.receiveShadow = true;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of materials) {
        if (mat && (mat as ProjectionMaterial).isMeshStandardMaterial) {
          this.projectionMaterials.push(mat as ProjectionMaterial);
        }
      }
    });
  }

  private buildImportPlaceholder(object: ProjectionSimObject, label: string): THREE.Object3D {
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 1.4, 1.4),
      new THREE.MeshStandardMaterial({ color: object.color, roughness: 0.9, wireframe: true }),
    );
    mesh.name = label;
    mesh.castShadow = object.castShadow;
    mesh.receiveShadow = true;
    group.add(mesh);
    return group;
  }

  private async loadModel(object: ProjectionSimObject, holder: THREE.Group): Promise<void> {
    if (!object.assetUrl) return;
    const key = `${object.assetFormat ?? 'gltf'}:${object.assetUrl}`;
    let promise = this.modelCache.get(key);
    if (!promise) {
      promise = this.loadModelObject(object);
      this.modelCache.set(key, promise);
    }
    try {
      const loadedModel = await promise;
      if (!holder.parent) return;
      const loaded = SkeletonUtils.clone(loadedModel.scene);
      this.clearGroup(holder);
      this.normalizeImportedObject(loaded);
      loaded.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.userData.projectionSimSharedGeometry = true;
        mesh.castShadow = object.castShadow;
        mesh.receiveShadow = true;
        const sourceMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const projectionMaterials = sourceMaterials.map((sourceMaterial) =>
          makeProjectionMaterial(object, this.currentScene?.environment.surfaceStyle, sourceMaterial),
        );
        mesh.material = Array.isArray(mesh.material) ? projectionMaterials : projectionMaterials[0];
        this.projectionMaterials.push(...projectionMaterials);
      });
      holder.add(loaded);
      this.lastDepthHash = '';
      this.lastShadowHash = '';
      if (loadedModel.animations.length) {
        const mixer = new THREE.AnimationMixer(loaded);
        for (const clip of loadedModel.animations) {
          mixer.clipAction(clip).play();
        }
        this.animationMixers.push(mixer);
      }
    } catch (err) {
      console.warn('[ProjectionSim] model import failed:', err);
    }
  }

  private async loadModelObject(object: ProjectionSimObject): Promise<LoadedModelData> {
    const url = object.assetUrl!;
    const format = object.assetFormat;
    if (format === 'obj') {
      return { scene: await new OBJLoader().loadAsync(url), animations: [] };
    }
    if (format === 'fbx') {
      const scene = await new FBXLoader().loadAsync(url);
      return { scene, animations: scene.animations ?? [] };
    }
    const gltf = await new GLTFLoader().loadAsync(url);
    return { scene: gltf.scene, animations: gltf.animations ?? [] };
  }

  private async loadPointCloud(object: ProjectionSimObject, holder: THREE.Group): Promise<void> {
    if (!object.assetUrl) return;
    try {
      const ply = await loadPLY(object.assetUrl);
      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array(ply.vertices.length * 3);
      const colors = new Float32Array(ply.vertices.length * 3);
      const sx = ply.boundingBox.max.x - ply.boundingBox.min.x || 1;
      const sy = ply.boundingBox.max.y - ply.boundingBox.min.y || 1;
      const sz = ply.boundingBox.max.z - ply.boundingBox.min.z || 1;
      const maxDim = Math.max(sx, sy, sz);
      for (let i = 0; i < ply.vertices.length; i++) {
        const v = ply.vertices[i];
        positions[i * 3] = (v.x - ply.center.x) / maxDim;
        positions[i * 3 + 1] = (v.y - ply.center.y) / maxDim;
        positions[i * 3 + 2] = (v.z - ply.center.z) / maxDim;
        colors[i * 3] = (v.r ?? 255) / 255;
        colors[i * 3 + 1] = (v.g ?? 255) / 255;
        colors[i * 3 + 2] = (v.b ?? 255) / 255;
      }
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geometry.computeBoundingSphere();
      const points = new THREE.Points(
        geometry,
        new THREE.PointsMaterial({
          size: object.pointSize ?? 0.035,
          vertexColors: true,
          transparent: true,
          opacity: 0.92,
          sizeAttenuation: true,
        }),
      );
      this.clearGroup(holder);
      holder.add(points);
      this.lastDepthHash = '';
      this.lastShadowHash = '';
    } catch (err) {
      console.warn('[ProjectionSim] point cloud import failed:', err);
    }
  }

  private normalizeImportedObject(obj: THREE.Object3D): void {
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    obj.position.sub(center);
    obj.scale.multiplyScalar(1 / maxDim);
  }

  private buildProjector(projector: ProjectionSimProjector): THREE.Object3D {
    const group = new THREE.Group();
    group.name = projector.name;
    group.userData.projectionSimTarget = `projector:${projector.id}`;

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.32, 0.72),
      new THREE.MeshStandardMaterial({ color: '#222831', roughness: 0.45, metalness: 0.2 }),
    );
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    const lens = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13, 0.13, 0.08, 24),
      new THREE.MeshStandardMaterial({ color: projector.color, emissive: projector.color, emissiveIntensity: 0.8 }),
    );
    lens.rotation.x = Math.PI / 2;
    lens.position.z = -0.4;
    group.add(lens);

    if (projector.showFrustum) {
      group.add(this.buildProjectorBeam(projector));
    }

    this.applyProjectorTransform(group, projector);
    return group;
  }

  private buildProjectorBeam(projector: ProjectionSimProjector): THREE.Object3D {
    const group = new THREE.Group();
    group.name = 'Projection beam';
    group.userData.projectionSimPickable = false;
    group.userData.projectionSimBeam = true;

    const distance = vec3(projector.position).distanceTo(vec3(projector.target));
    const far = Math.max(2.5, distance * 1.18);
    const halfH = Math.tan(THREE.MathUtils.degToRad(projector.fov) * 0.5) * far;
    const halfW = halfH * projector.aspect;
    const origin = new THREE.Vector3(0, 0, -0.42);
    const corners = [
      new THREE.Vector3(-halfW, -halfH, -far),
      new THREE.Vector3( halfW, -halfH, -far),
      new THREE.Vector3( halfW,  halfH, -far),
      new THREE.Vector3(-halfW,  halfH, -far),
    ];

    const linePositions: number[] = [];
    for (const corner of corners) linePositions.push(origin.x, origin.y, origin.z, corner.x, corner.y, corner.z);
    for (let i = 0; i < 4; i++) {
      const a = corners[i];
      const b = corners[(i + 1) % 4];
      linePositions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
    const wire = new THREE.LineSegments(
      lineGeometry,
      new THREE.LineBasicMaterial({
        color: projector.color,
        transparent: true,
        opacity: 0.72,
        depthWrite: false,
      }),
    );
    group.add(wire);

    const volumePositions: number[] = [];
    const faces = [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
    ];
    for (const [aIdx, bIdx] of faces) {
      const a = corners[aIdx];
      const b = corners[bIdx];
      volumePositions.push(origin.x, origin.y, origin.z, a.x, a.y, a.z, b.x, b.y, b.z);
    }
    const volumeGeometry = new THREE.BufferGeometry();
    volumeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(volumePositions, 3));
    volumeGeometry.computeVertexNormals();
    const volume = new THREE.Mesh(
      volumeGeometry,
      new THREE.MeshBasicMaterial({
        color: projector.color,
        transparent: true,
        opacity: 0.055,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    group.add(volume);
    group.traverse((child) => {
      child.userData.projectionSimPickable = false;
      child.userData.projectionSimBeam = true;
    });
    return group;
  }

  private syncTransforms(sceneState: ProjectionSimScene): void {
    for (const object of sceneState.objects) {
      const group = this.selectable.get(`object:${object.id}`);
      if (group) this.applyObjectTransform(group, object);
    }
    for (const projector of sceneState.projectors) {
      const group = this.selectable.get(`projector:${projector.id}`);
      if (group) this.applyProjectorTransform(group, projector);
    }
  }

  private applyObjectTransform(group: THREE.Object3D, object: ProjectionSimObject): void {
    group.visible = object.visible;
    group.position.set(...object.position);
    group.rotation.set(...object.rotation);
    group.scale.set(...object.scale);
  }

  private applyProjectorTransform(group: THREE.Object3D, projector: ProjectionSimProjector): void {
    group.visible = projector.enabled;
    this.applyProjectorObjectTransform(group, vec3(projector.position), vec3(projector.target));
  }

  private applyProjectorObjectTransform(group: THREE.Object3D, position: THREE.Vector3, target: THREE.Vector3): void {
    group.position.copy(position);
    LOOK_AT_MATRIX.lookAt(group.position, target, group.up);
    group.quaternion.setFromRotationMatrix(LOOK_AT_MATRIX);
  }

  private updateSelectionOutline(): void {
    if (this.recordingMode) {
      this.selectionOutline.visible = false;
      this.multiSelectionBox.visible = false;
      return;
    }

    const selectedVisibleTargets = (this.selectedTargets.length ? this.selectedTargets : (this.selected ? [this.selected] : []))
      .filter((target): target is NonNullable<ProjectionSimSelection> => Boolean(target && this.selectable.get(target)?.visible));

    if (selectedVisibleTargets.length > 1) {
      const box = this.getSelectionBox(selectedVisibleTargets);
      if (!box) {
        this.multiSelectionBox.visible = false;
        this.selectionOutline.visible = false;
        return;
      }
      this.multiSelectionBox.box.copy(box);
      this.multiSelectionBox.visible = true;
      this.selectionOutline.visible = false;
      return;
    }

    this.multiSelectionBox.visible = false;

    if (!this.selected?.startsWith('object:')) {
      this.selectionOutline.visible = false;
      return;
    }

    const selectedObject = this.selectable.get(this.selected);
    if (!selectedObject || !selectedObject.visible) {
      this.selectionOutline.visible = false;
      return;
    }

    this.selectionOutline.setFromObject(selectedObject);
    this.selectionOutline.visible = true;
  }

  private updateProjectorData(sceneState: ProjectionSimScene, outputSlices: OutputSlice[]): void {
    const enabled = sceneState.projectors.filter((p) => p.enabled).slice(0, MAX_PROJECTORS);
    const liveIds = new Set<string>();
    this.projectors.length = 0;

    for (const projector of enabled) {
      liveIds.add(projector.id);
      let data = this.projectorDataById.get(projector.id);
      if (!data) {
        data = {
          camera: new THREE.PerspectiveCamera(projector.fov, projector.aspect, 0.1, 120),
          matrix: new THREE.Matrix4(),
          position: new THREE.Vector3(),
          crop: DEFAULT_CROP.clone(),
          blend: ZERO_BLEND.clone(),
          tint: WHITE.clone(),
          opacity: projector.opacity,
          intensity: projector.intensity,
          depthTexture: null,
        };
        this.projectorDataById.set(projector.id, data);
      }

      data.camera.fov = projector.fov;
      data.camera.aspect = projector.aspect;
      data.camera.position.set(...projector.position);
      data.camera.lookAt(...projector.target);
      data.camera.updateMatrixWorld(true);
      data.camera.updateProjectionMatrix();
      data.matrix.multiplyMatrices(data.camera.projectionMatrix, data.camera.matrixWorldInverse);
      data.position.set(...projector.position);

      data.crop.set(...projector.crop);
      data.blend.set(...projector.edgeBlend);
      if (projector.source === 'slice' && projector.sliceId) {
        const slice = outputSlices.find((s) => s.id === projector.sliceId);
        if (slice) {
          data.crop.set(slice.cropX, slice.cropY, slice.cropW, slice.cropH);
          data.blend.set(
            slice.edgeBlendLeft ?? 0,
            slice.edgeBlendRight ?? 0,
            slice.edgeBlendTop ?? 0,
            slice.edgeBlendBottom ?? 0,
          );
        }
      }

      setColorVec3(data.tint, projector.color);
      data.opacity = projector.opacity;
      data.intensity = projector.intensity;
      this.projectors.push(data);
    }

    for (const id of this.projectorDataById.keys()) {
      if (!liveIds.has(id)) this.projectorDataById.delete(id);
    }

    this.syncProjectorLights(sceneState);
  }

  private renderProjectorDepthMaps(depthHash: string): void {
    if (!this.projectors.length) {
      this.lastDepthHash = depthHash;
      return;
    }

    const canReuseDepth = depthHash === this.lastDepthHash
      && this.projectors.every((projector, index) => Boolean(projector.depthTexture ?? this.depthTargets[index]?.texture));
    if (canReuseDepth) {
      for (let i = 0; i < this.projectors.length; i++) {
        this.projectors[i].depthTexture = this.depthTargets[i]?.texture ?? this.whiteDepthTexture;
      }
      return;
    }

    const previousTarget = this.renderer.getRenderTarget();
    const previousOverride = this.scene.overrideMaterial;
    const previousBackground = this.scene.background;
    const previousAutoClear = this.renderer.autoClear;
    const previousProjectorVisible = this.projectorRoot.visible;
    const previousGridVisible = this.grid?.visible ?? true;
    const previousTransformVisible = this.transformHelper.visible;
    const previousSelectionOutlineVisible = this.selectionOutline.visible;
    const previousMultiSelectionBoxVisible = this.multiSelectionBox.visible;

    this.scene.background = null;
    this.scene.overrideMaterial = this.depthMaterial;
    this.renderer.autoClear = true;
    this.projectorRoot.visible = false;
    if (this.grid) this.grid.visible = false;
    this.transformHelper.visible = false;
    this.selectionOutline.visible = false;
    this.multiSelectionBox.visible = false;

    for (let i = 0; i < this.projectors.length; i++) {
      const target = this.getDepthTarget(i);
      this.renderer.setRenderTarget(target);
      this.renderer.clear();
      this.renderer.render(this.scene, this.projectors[i].camera);
      this.projectors[i].depthTexture = target.texture;
    }

    this.lastDepthHash = depthHash;

    this.renderer.setRenderTarget(previousTarget);
    this.scene.overrideMaterial = previousOverride;
    this.scene.background = previousBackground;
    this.renderer.autoClear = previousAutoClear;
    this.projectorRoot.visible = previousProjectorVisible;
    if (this.grid) this.grid.visible = previousGridVisible;
    this.transformHelper.visible = previousTransformVisible;
    this.selectionOutline.visible = previousSelectionOutlineVisible;
    this.multiSelectionBox.visible = previousMultiSelectionBoxVisible;
  }

  private getDepthTarget(index: number): THREE.WebGLRenderTarget {
    let target = this.depthTargets[index];
    if (!target) {
      target = new THREE.WebGLRenderTarget(1024, 1024, {
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        depthBuffer: true,
        stencilBuffer: false,
      });
      target.texture.name = `ProjectionSimDepth${index}`;
      target.texture.generateMipmaps = false;
      this.depthTargets[index] = target;
    }
    return target;
  }

  private syncProjectorLights(sceneState: ProjectionSimScene): void {
    const liveIds = new Set<string>();
    const active = this.projectorShadowStrength > 0
      ? sceneState.projectors.filter((p) => p.enabled).slice(0, MAX_PROJECTORS)
      : [];

    for (const projector of active) {
      liveIds.add(projector.id);
      let entry = this.projectorLights.get(projector.id);
      if (!entry) {
        const light = new THREE.SpotLight(projector.color, projector.intensity * 40, 80, THREE.MathUtils.degToRad(projector.fov / 2), 0.72, 1.2);
        const target = new THREE.Object3D();
        light.castShadow = true;
        light.shadow.mapSize.width = 1024;
        light.shadow.mapSize.height = 1024;
        light.shadow.camera.near = 0.1;
        light.shadow.camera.far = 80;
        light.userData.lightOnly = true;
        target.userData.lightOnly = true;
        light.target = target;
        this.projectorRoot.add(light);
        this.projectorRoot.add(target);
        entry = { light, target };
        this.projectorLights.set(projector.id, entry);
      }

      entry.light.color.set(projector.color);
      entry.light.intensity = projector.intensity * 40;
      entry.light.angle = THREE.MathUtils.degToRad(projector.fov / 2);
      entry.light.shadow.intensity = THREE.MathUtils.clamp(this.projectorShadowStrength, 0, 1);
      entry.light.position.set(...projector.position);
      entry.target.position.set(...projector.target);
      entry.light.target.updateMatrixWorld();
    }

    for (const [id, entry] of this.projectorLights) {
      if (liveIds.has(id)) continue;
      this.projectorRoot.remove(entry.light);
      this.projectorRoot.remove(entry.target);
      entry.light.shadow.map?.dispose();
      this.projectorLights.delete(id);
    }
  }

  private disposeProjectorLights(): void {
    for (const entry of this.projectorLights.values()) {
      entry.light.shadow.map?.dispose();
    }
    this.projectorLights.clear();
  }

  private updateShadowDirtyState(sceneState: ProjectionSimScene, depthHash: string): void {
    if (this.projectorShadowStrength <= 0) {
      this.lastShadowHash = '';
      this.renderer.shadowMap.needsUpdate = false;
      return;
    }

    if (depthHash !== this.lastShadowHash) {
      this.renderer.shadowMap.needsUpdate = true;
      this.lastShadowHash = depthHash;
    } else {
      this.renderer.shadowMap.needsUpdate = false;
    }
  }

  private updateProjectionUniforms(): void {
    for (let i = 0; i < MAX_PROJECTORS; i++) {
      const projector = this.projectors[i];
      if (projector) {
        this.uniformMatrices[i].copy(projector.matrix);
        this.uniformPositions[i].copy(projector.position);
        this.uniformCrops[i].copy(projector.crop);
        this.uniformBlends[i].copy(projector.blend);
        this.uniformTints[i].copy(projector.tint);
        this.uniformOpacities[i] = projector.opacity;
        this.uniformIntensities[i] = Math.max(0, projector.intensity);
        this.uniformDepths[i] = projector.depthTexture ?? this.whiteDepthTexture;
      } else {
        this.uniformMatrices[i].copy(IDENTITY);
        this.uniformPositions[i].set(0, 0, 0);
        this.uniformCrops[i].copy(DEFAULT_CROP);
        this.uniformBlends[i].copy(ZERO_BLEND);
        this.uniformTints[i].copy(WHITE);
        this.uniformOpacities[i] = 0;
        this.uniformIntensities[i] = 1;
        this.uniformDepths[i] = this.whiteDepthTexture;
      }
    }

    for (const material of this.projectionMaterials) {
      const shader = material.userData.projectionShader;
      if (!shader) continue;
      shader.uniforms.uProjectionTexture.value = this.sourceTexture;
      shader.uniforms.uProjectorCount.value = this.sourceTexture ? this.projectors.length : 0;
      shader.uniforms.uProjectorMatrices.value = this.uniformMatrices;
      shader.uniforms.uProjectorPositions.value = this.uniformPositions;
      shader.uniforms.uProjectorCrops.value = this.uniformCrops;
      shader.uniforms.uProjectorBlends.value = this.uniformBlends;
      shader.uniforms.uProjectorTints.value = this.uniformTints;
      shader.uniforms.uProjectorOpacities.value = this.uniformOpacities;
      shader.uniforms.uProjectorIntensities.value = this.uniformIntensities;
      shader.uniforms.uProjectorDepth0.value = this.uniformDepths[0];
      shader.uniforms.uProjectorDepth1.value = this.uniformDepths[1];
      shader.uniforms.uProjectorDepth2.value = this.uniformDepths[2];
      shader.uniforms.uProjectorDepth3.value = this.uniformDepths[3];
      shader.uniforms.uProjectorDepthBias.value = DEPTH_BIAS;
      shader.uniforms.uProjectorShadowStrength.value = this.projectorShadowStrength;
    }
  }

  private updateImportedAnimations(): void {
    if (!this.animationMixers.length) {
      this.animationClock.getDelta();
      return;
    }
    const delta = Math.min(0.05, this.animationClock.getDelta());
    for (const mixer of this.animationMixers) mixer.update(delta);
    const now = performance.now();
    if (now - this.lastAnimationDepthRefresh > 1000 / 30) {
      this.lastAnimationDepthRefresh = now;
      this.lastDepthHash = '';
      this.lastShadowHash = '';
    }
  }

  private publishTransform(): void {
    if (this.attachedSelection === '__multi__') {
      this.publishMultiTransform();
      return;
    }
    if (!this.selected) return;
    const obj = this.selectable.get(this.selected);
    if (!obj) return;
    const [kind, id] = this.selected.split(':') as ['object' | 'projector', string];
    if (kind === 'projector') {
      const patch: ProjectionSimTransformPatch = { position: arr3(obj.position) };
      if (this.currentGizmoMode === 'rotate') {
        const projector = this.currentScene?.projectors.find((p) => p.id === id);
        const distance = Math.max(
          1,
          projector ? vec3(projector.position).distanceTo(vec3(projector.target)) : 5,
        );
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(obj.quaternion).normalize();
        patch.target = arr3(obj.position.clone().addScaledVector(forward, distance));
      }
      this.onTransform(this.selected, patch);
    } else {
      this.onTransform(this.selected, {
        position: arr3(obj.position),
        rotation: [round(obj.rotation.x), round(obj.rotation.y), round(obj.rotation.z)],
        scale: arr3(obj.scale),
      });
    }
  }

  private publishMultiTransform(): void {
    const snapshot = this.multiTransformStart ?? this.captureMultiTransformStart();
    if (!snapshot) return;
    if (!this.multiTransformStart) this.multiTransformStart = snapshot;

    this.multiTransformGroup.updateMatrixWorld(true);
    const deltaMatrix = this.multiTransformGroup.matrixWorld.clone().multiply(snapshot.matrixInverse);
    const deltaQuat = this.multiTransformGroup.quaternion.clone().multiply(snapshot.quaternionInverse);
    const scaleRatio = new THREE.Vector3(
      snapshot.scale.x !== 0 ? this.multiTransformGroup.scale.x / snapshot.scale.x : 1,
      snapshot.scale.y !== 0 ? this.multiTransformGroup.scale.y / snapshot.scale.y : 1,
      snapshot.scale.z !== 0 ? this.multiTransformGroup.scale.z / snapshot.scale.z : 1,
    );

    for (const item of snapshot.items) {
      const obj = this.selectable.get(item.target);
      if (!obj) continue;
      const nextPosition = item.position.clone().applyMatrix4(deltaMatrix);
      if (item.target.startsWith('projector:')) {
        const baseTarget = item.projectorTarget?.clone()
          ?? item.position.clone().add(new THREE.Vector3(0, 0, -5).applyQuaternion(item.quaternion));
        const nextTarget = baseTarget.applyMatrix4(deltaMatrix);
        this.applyProjectorObjectTransform(obj, nextPosition, nextTarget);
        this.onTransform(item.target, {
          position: arr3(nextPosition),
          target: arr3(nextTarget),
        });
        continue;
      }

      const nextQuaternion = deltaQuat.clone().multiply(item.quaternion);
      const nextScale = item.scale.clone().multiply(scaleRatio);
      obj.position.copy(nextPosition);
      obj.quaternion.copy(nextQuaternion);
      obj.scale.copy(nextScale);
      const euler = new THREE.Euler().setFromQuaternion(nextQuaternion, obj.rotation.order);
      this.onTransform(item.target, {
        position: arr3(nextPosition),
        rotation: [round(euler.x), round(euler.y), round(euler.z)],
        scale: arr3(nextScale),
      });
    }
  }

  private handlePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    this.pointerDown = { x: event.clientX, y: event.clientY };
  };

  private handlePointerUp = (event: PointerEvent): void => {
    if (event.button !== 0 || !this.pointerDown) return;
    const distance = Math.hypot(event.clientX - this.pointerDown.x, event.clientY - this.pointerDown.y);
    this.pointerDown = null;
    if (distance > 5 || this.transformDragging) return;

    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    this.pointer.y = -(((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);

    if (this.transformHelper.visible && this.raycaster.intersectObject(this.transformHelper, true).length) {
      return;
    }

    const objectTarget = this.pickTarget('object');
    if (objectTarget) {
      this.onSelect(objectTarget, event);
      return;
    }

    if (this.pickProjectors) {
      const projectorTarget = this.pickTarget('projector');
      if (projectorTarget) {
        this.onSelect(projectorTarget, event);
        return;
      }
    }

    if (!event.shiftKey && !event.metaKey && !event.ctrlKey) {
      this.onSelect(null, event);
    }
  };

  private pickTarget(kind: 'object' | 'projector'): ProjectionSimSelection {
    const prefix = `${kind}:`;
    const candidates = [...this.selectable.entries()]
      .filter(([target, object]) => (
        target.startsWith(prefix)
        && object.visible
      ))
      .map(([, object]) => object);
    if (!candidates.length) return null;

    const hits = this.raycaster.intersectObjects(candidates, true);
    for (const hit of hits) {
      const target = this.pickTargetFromObject(hit.object, prefix);
      if (target) return target;
    }
    return null;
  }

  private pickTargetFromObject(object: THREE.Object3D, prefix: string): ProjectionSimSelection {
    let obj: THREE.Object3D | null = object;
    while (obj) {
      if (obj.userData.projectionSimPickable === false) return null;
      const target = obj.userData.projectionSimTarget as ProjectionSimSelection;
      if (target?.startsWith(prefix)) return target;
      obj = obj.parent;
    }
    return null;
  }

  private clearGroup(group: THREE.Group): void {
    for (const child of [...group.children]) {
      group.remove(child);
      child.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry && !mesh.userData.projectionSimSharedGeometry) mesh.geometry.dispose();
        const mat = mesh.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose?.();
      });
    }
  }
}
