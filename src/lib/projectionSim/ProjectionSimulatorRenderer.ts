import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import type { OutputSlice } from '../stores/settings';
import { blue } from '../theming/blueScale';
import type {
  ProjectionSimGizmoMode,
  ProjectionSimObject,
  ProjectionSimProjector,
  ProjectionSimScene,
  ProjectionSimSelection,
  ProjectionSimVec3,
} from './types';
import {
  loadProjectionSimModel,
  loadProjectionSimPly,
  normalizeImportedObject,
  primitiveParts,
  type LoadedModelData,
} from './geometry';
import {
  projectorBasis,
  projectorFrustumCorners,
  projectorProjectionMatrix,
  projectorRollFromAxes,
  projectorWorldMatrix,
} from './projectorLens';
import { projectorContentCrop, projectorOutputBlend } from './projectorViewPayload';

const MAX_PROJECTORS = 4;
/** Depth maps live in one atlas so the projection shader needs a single
 *  sampler for all of them: four projector slots plus four slots for the
 *  lenses other projectors take their content from. */
const DEPTH_TILE = 1024;
const DEPTH_ATLAS_COLUMNS = 4;
const DEPTH_ATLAS_ROWS = 2;
const MAX_DEPTH_SLOTS = DEPTH_ATLAS_COLUMNS * DEPTH_ATLAS_ROWS;
const CALIBRATION_SNAP_PX = 16;
const IDENTITY = new THREE.Matrix4();
const DEFAULT_CROP = new THREE.Vector4(0, 0, 1, 1);
const ZERO_BLEND = new THREE.Vector4(0, 0, 0, 0);
const WHITE = new THREE.Vector3(1, 1, 1);
const DEPTH_BIAS = 0.0018;
const SCRATCH_COLOR = new THREE.Color();
const SRGB_ENCODE_LUT = Uint8Array.from({ length: 256 }, (_, i) => {
  const c = i / 255;
  const encoded = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, encoded)) * 255);
});

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
  /** Projector roll about the lens axis, degrees. */
  roll?: number;
}

interface ProjectorRenderData {
  id: string;
  camera: THREE.PerspectiveCamera;
  matrix: THREE.Matrix4;
  position: THREE.Vector3;
  blend: THREE.Vector4;
  tint: THREE.Vector3;
  opacity: number;
  intensity: number;
  depthSlot: number;
  /** The lens that lays the content on the surfaces for this projector. */
  mapId: string;
  mapMatrix: THREE.Matrix4;
  mapPosition: THREE.Vector3;
  mapCrop: THREE.Vector4;
  mapDepthSlot: number;
}

interface DepthCamera {
  id: string;
  camera: THREE.PerspectiveCamera;
}

/** A calibration point shown on the model. */
export interface ProjectionSimCalibrationMarker {
  id: string;
  label: string;
  world: ProjectionSimVec3;
  matched: boolean;
  selected: boolean;
}

/** A pick on the model while calibrating. */
export interface ProjectionSimModelPick {
  world: ProjectionSimVec3;
  objectId: string | null;
  snapped: boolean;
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
      showFloorProjection: scene.environment.showFloorProjection,
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
      lensShift: p.lensShift,
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
      .filter((projector) => projector.enabled || scene.projectors.some((p) => p.enabled && p.contentFrom === projector.id))
      .map((projector) => ({
        id: projector.id,
        enabled: projector.enabled,
        position: projector.position,
        target: projector.target,
        roll: projector.roll,
        fov: projector.fov,
        aspect: projector.aspect,
        lensShift: projector.lensShift,
        near: projector.near,
        far: projector.far,
        contentFrom: projector.contentFrom,
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
    shader.uniforms.uProjectorBlends = { value: Array.from({ length: MAX_PROJECTORS }, () => ZERO_BLEND.clone()) };
    shader.uniforms.uProjectorTints = { value: Array.from({ length: MAX_PROJECTORS }, () => WHITE.clone()) };
    shader.uniforms.uProjectorOpacities = { value: new Array(MAX_PROJECTORS).fill(0) };
    shader.uniforms.uProjectorIntensities = { value: new Array(MAX_PROJECTORS).fill(1) };
    shader.uniforms.uProjectorDepthSlots = { value: new Array(MAX_PROJECTORS).fill(0) };
    shader.uniforms.uProjectorMapMatrices = { value: Array.from({ length: MAX_PROJECTORS }, () => IDENTITY.clone()) };
    shader.uniforms.uProjectorMapPositions = { value: Array.from({ length: MAX_PROJECTORS }, () => new THREE.Vector3()) };
    shader.uniforms.uProjectorMapCrops = { value: Array.from({ length: MAX_PROJECTORS }, () => DEFAULT_CROP.clone()) };
    shader.uniforms.uProjectorMapDepthSlots = { value: new Array(MAX_PROJECTORS).fill(0) };
    shader.uniforms.uProjectorMapSelf = { value: new Array(MAX_PROJECTORS).fill(1) };
    shader.uniforms.uProjectorDepthAtlas = { value: null };
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
uniform vec4 uProjectorBlends[${MAX_PROJECTORS}];
uniform vec3 uProjectorTints[${MAX_PROJECTORS}];
uniform float uProjectorOpacities[${MAX_PROJECTORS}];
uniform float uProjectorIntensities[${MAX_PROJECTORS}];
uniform float uProjectorDepthSlots[${MAX_PROJECTORS}];
uniform mat4 uProjectorMapMatrices[${MAX_PROJECTORS}];
uniform vec3 uProjectorMapPositions[${MAX_PROJECTORS}];
uniform vec4 uProjectorMapCrops[${MAX_PROJECTORS}];
uniform float uProjectorMapDepthSlots[${MAX_PROJECTORS}];
uniform float uProjectorMapSelf[${MAX_PROJECTORS}];
uniform sampler2D uProjectorDepthAtlas;
uniform float uProjectorDepthBias;
uniform float uProjectorShadowStrength;
varying vec3 vProjectionWorldPosition;
varying vec3 vProjectionWorldNormal;

// uv is y-up here, so the top band is measured from 1.
float psimEdgeFade(vec2 uv, vec4 blend) {
  float l = blend.x <= 0.0001 ? 1.0 : smoothstep(0.0, blend.x, uv.x);
  float r = blend.y <= 0.0001 ? 1.0 : smoothstep(0.0, blend.y, 1.0 - uv.x);
  float t = blend.z <= 0.0001 ? 1.0 : smoothstep(0.0, blend.z, 1.0 - uv.y);
  float b = blend.w <= 0.0001 ? 1.0 : smoothstep(0.0, blend.w, uv.y);
  return clamp(min(min(l, r), min(t, b)), 0.0, 1.0);
}

float psimDepthAt(float slot, vec2 uv) {
  vec2 tile = vec2(mod(slot, ${DEPTH_ATLAS_COLUMNS}.0), floor(slot / ${DEPTH_ATLAS_COLUMNS}.0));
  vec2 inset = clamp(uv, vec2(0.5 / ${DEPTH_TILE}.0), vec2(1.0 - 0.5 / ${DEPTH_TILE}.0));
  vec2 atlasUv = (tile + inset) / vec2(${DEPTH_ATLAS_COLUMNS}.0, ${DEPTH_ATLAS_ROWS}.0);
  return unpackRGBAToDepth(texture2D(uProjectorDepthAtlas, atlasUv));
}

// Where a lens sees a world point: xy = uv (y up), z = depth (0..1),
// w = 1 inside its frustum.
vec4 psimLensUv(mat4 lens, vec3 worldPosition) {
  vec4 p = lens * vec4(worldPosition, 1.0);
  vec3 ndc = p.xyz / max(0.0001, p.w);
  float inside = step(0.0, p.w)
    * step(-1.0, ndc.x) * step(ndc.x, 1.0)
    * step(-1.0, ndc.y) * step(ndc.y, 1.0)
    * step(-1.0, ndc.z) * step(ndc.z, 1.0);
  return vec4(ndc.xy * 0.5 + 0.5, ndc.z * 0.5 + 0.5, inside);
}

float psimFacing(vec3 lensPosition) {
  return smoothstep(
    0.01,
    0.08,
    dot(normalize(vProjectionWorldNormal), normalize(lensPosition - vProjectionWorldPosition))
  );
}
`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
vec3 psimSurfaceColor = diffuseColor.rgb;
vec3 psimProjectedLight = vec3(0.0);
float psimShadow = clamp(uProjectorShadowStrength, 0.0, 1.0);
for (int i = 0; i < ${MAX_PROJECTORS}; i++) {
  if (i >= uProjectorCount) break;
  // Light leaving projector i...
  vec4 lens = psimLensUv(uProjectorMatrices[i], vProjectionWorldPosition);
  float occlusionVisibility = step(lens.z - uProjectorDepthBias, psimDepthAt(uProjectorDepthSlots[i], lens.xy));
  float visibleFromProjector = mix(1.0, occlusionVisibility, psimShadow);
  float edge = psimEdgeFade(lens.xy, uProjectorBlends[i]);
  float w = lens.w * visibleFromProjector * psimFacing(uProjectorPositions[i]) * edge * uProjectorOpacities[i];
  // ...carries the content its mapping lens lays on this point: its own
  // image, or the image another projector throws here.
  vec4 mapped = lens;
  if (uProjectorMapSelf[i] < 0.5) {
    mapped = psimLensUv(uProjectorMapMatrices[i], vProjectionWorldPosition);
    float mapVisibility = step(mapped.z - uProjectorDepthBias, psimDepthAt(uProjectorMapDepthSlots[i], mapped.xy));
    w *= mapped.w * mix(1.0, mapVisibility, psimShadow) * psimFacing(uProjectorMapPositions[i]);
  }
  // Crops are top-down on the master; the canvas texture is y-up.
  vec4 crop = uProjectorMapCrops[i];
  vec2 croppedUv = vec2(crop.x + mapped.x * crop.z, 1.0 - (crop.y + (1.0 - mapped.y) * crop.w));
  vec3 projected = texture2D(uProjectionTexture, croppedUv).rgb;
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
  private depthAtlas: THREE.WebGLRenderTarget | null = null;
  private depthCameras: DepthCamera[] = [];
  private calibrationRoot = new THREE.Group();
  private calibrationMarkersHash = '';
  private pickMode: 'select' | 'calibrate' = 'select';
  private snapToVertices = true;
  private onModelPick: ((pick: ProjectionSimModelPick) => void) | null = null;
  private previewTarget: THREE.WebGLRenderTarget | null = null;
  private viewInsetBottom = 0;
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
  private uniformBlends = Array.from({ length: MAX_PROJECTORS }, () => ZERO_BLEND.clone());
  private uniformTints = Array.from({ length: MAX_PROJECTORS }, () => WHITE.clone());
  private uniformOpacities = new Array(MAX_PROJECTORS).fill(0);
  private uniformIntensities = new Array(MAX_PROJECTORS).fill(1);
  private uniformDepthSlots = new Array(MAX_PROJECTORS).fill(0);
  private uniformMapMatrices = Array.from({ length: MAX_PROJECTORS }, () => IDENTITY.clone());
  private uniformMapPositions = Array.from({ length: MAX_PROJECTORS }, () => new THREE.Vector3());
  private uniformMapCrops = Array.from({ length: MAX_PROJECTORS }, () => DEFAULT_CROP.clone());
  private uniformMapDepthSlots = new Array(MAX_PROJECTORS).fill(0);
  private uniformMapSelf = new Array(MAX_PROJECTORS).fill(1);
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
    this.calibrationRoot.name = 'Calibration points';
    this.calibrationRoot.userData.projectionSimPickable = false;
    this.scene.add(this.calibrationRoot);

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
    this.disposeProjectorLights();
    this.clearGroup(this.root);
    this.clearGroup(this.projectorRoot);
    this.sourceTexture?.dispose();
    this.depthMaterial.dispose();
    this.selectionOutline.geometry.dispose();
    (this.selectionOutline.material as THREE.Material).dispose();
    this.multiSelectionBox.geometry.dispose();
    (this.multiSelectionBox.material as THREE.Material).dispose();
    this.depthAtlas?.dispose();
    this.previewTarget?.dispose();
    this.clearGroup(this.calibrationRoot);
    this.renderer.dispose();
  }

  setGizmoMode(mode: ProjectionSimGizmoMode): void {
    this.currentGizmoMode = mode;
    this.transformControls.setMode(mode);
  }

  setPickProjectors(enabled: boolean): void {
    this.pickProjectors = enabled;
  }

  /** In 'calibrate' mode a click on the model reports the exact surface
   *  point (optionally snapped to the nearest vertex) instead of selecting. */
  setPickMode(mode: 'select' | 'calibrate', onModelPick: ((pick: ProjectionSimModelPick) => void) | null = null): void {
    this.pickMode = mode;
    this.onModelPick = mode === 'calibrate' ? onModelPick : null;
    if (mode === 'calibrate') {
      this.transformControls.detach();
      this.attachedSelection = null;
    }
  }

  setSnapToVertices(enabled: boolean): void {
    this.snapToVertices = enabled;
  }

  /** Numbered spheres on the picked calibration points. */
  setCalibrationMarkers(markers: ProjectionSimCalibrationMarker[]): void {
    const hash = JSON.stringify(markers);
    if (hash === this.calibrationMarkersHash) return;
    this.calibrationMarkersHash = hash;
    this.clearGroup(this.calibrationRoot);
    const box = new THREE.Box3();
    for (const child of this.root.children) {
      if (child.userData.projectionSimTarget) box.expandByObject(child);
    }
    const sceneSize = box.isEmpty() ? 4 : box.getSize(new THREE.Vector3()).length();
    const radius = THREE.MathUtils.clamp(sceneSize * 0.012, 0.025, 0.12);
    for (const marker of markers) {
      const color = marker.selected ? blue(300) : marker.matched ? '#ffcf3a' : '#ff5a7a';
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(radius, 16, 10),
        new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 }),
      );
      sphere.renderOrder = 10;
      sphere.position.set(...marker.world);
      this.calibrationRoot.add(sphere);
      const label = this.makeLabelSprite(marker.label, color);
      label.position.set(marker.world[0], marker.world[1] + radius * 3.2, marker.world[2]);
      label.scale.setScalar(radius * 5);
      this.calibrationRoot.add(label);
    }
    this.calibrationRoot.traverse((child) => {
      child.userData.projectionSimPickable = false;
    });
  }

  private makeLabelSprite(text: string, color: string): THREE.Sprite {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = 'rgba(5, 7, 11, 0.8)';
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 30px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, size / 2, size / 2 + 1);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }));
    sprite.renderOrder = 11;
    return sprite;
  }

  /** The scene as one projector sees it (its lens, no editor helpers), for
   *  the calibration pad. Returns top-down sRGB pixels. */
  renderProjectorPreview(projectorId: string, width: number, height: number): ImageData | null {
    const projector = this.currentScene?.projectors.find((p) => p.id === projectorId);
    if (!projector) return null;
    const w = Math.max(2, Math.round(width));
    const h = Math.max(2, Math.round(height));
    if (!this.previewTarget || this.previewTarget.width !== w || this.previewTarget.height !== h) {
      this.previewTarget?.dispose();
      this.previewTarget = new THREE.WebGLRenderTarget(w, h, { depthBuffer: true, stencilBuffer: false });
    }
    const camera = new THREE.PerspectiveCamera();
    this.applyLensToCamera(camera, projector);
    const previousTarget = this.renderer.getRenderTarget();
    const hidden = this.hideHelpers({ projectors: true, grid: false, calibration: true });
    this.projectorRoot.traverse((child) => {
      if (child.userData.projectionSimBeam && child.visible) {
        child.visible = false;
        hidden.push(child);
      }
    });
    const pixels = new Uint8Array(w * h * 4);
    try {
      this.renderer.setRenderTarget(this.previewTarget);
      this.renderer.clear();
      this.renderer.render(this.scene, camera);
      this.renderer.readRenderTargetPixels(this.previewTarget, 0, 0, w, h, pixels);
    } finally {
      this.renderer.setRenderTarget(previousTarget);
      this.restoreHelpers(hidden);
    }
    // Render targets hold linear light; encode to sRGB for the 2D canvas.
    const out = new ImageData(w, h);
    const lut = SRGB_ENCODE_LUT;
    for (let y = 0; y < h; y++) {
      const src = (h - 1 - y) * w * 4;
      const dst = y * w * 4;
      for (let x = 0; x < w * 4; x += 4) {
        out.data[dst + x] = lut[pixels[src + x]];
        out.data[dst + x + 1] = lut[pixels[src + x + 1]];
        out.data[dst + x + 2] = lut[pixels[src + x + 2]];
        out.data[dst + x + 3] = 255;
      }
    }
    return out;
  }

  /** Client (CSS pixel) position of a world point in the orbit view, or
   *  null when it is behind the camera. */
  worldToClient(world: ProjectionSimVec3): { x: number; y: number } | null {
    const p = new THREE.Vector3(...world);
    this.camera.updateMatrixWorld();
    const ndc = p.clone().project(this.camera);
    if (ndc.z < -1 || ndc.z > 1) return null;
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: rect.left + (ndc.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (1 - (ndc.y * 0.5 + 0.5)) * rect.height,
    };
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
    if (this.pickMode === 'calibrate') {
      this.transformControls.detach();
      this.attachedSelection = null;
      this.multiTransformGroup.visible = false;
      return;
    }
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

  getCameraState(): ProjectionSimScene['camera'] {
    return {
      position: arr3(this.camera.position),
      target: arr3(this.controls.target),
      fov: this.camera.fov,
    };
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

  async captureFrameAt(width = 1920, height = 1080): Promise<{ data: Uint8Array; width: number; height: number }> {
    const w = Math.max(2, Math.round(width));
    const h = Math.max(2, Math.round(height));
    const previousRecordingMode = this.recordingMode;
    const previousTarget = this.renderer.getRenderTarget();
    const previousAutoClear = this.renderer.autoClear;
    try {
      this.recordingMode = true;
      this.resize(w, h, true);
      this.renderMainScene();
      const pixels = new Uint8Array(w * h * 4);
      const gl = this.renderer.getContext();
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return { data: this.copyFlippedOpaqueFrame(pixels, w, h), width: w, height: h };
    } finally {
      this.renderer.setRenderTarget(previousTarget);
      this.renderer.autoClear = previousAutoClear;
      this.recordingMode = previousRecordingMode;
      this.resize(undefined, undefined, true);
    }
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
    hide(this.calibrationRoot);
    this.projectorRoot.traverse((child) => {
      if (child.userData.projectionSimBeam) hide(child);
    });

    this.renderer.render(this.scene, this.camera);

    for (const object of hidden) object.visible = true;
  }

  private copyFlippedOpaqueFrame(src: Uint8Array, width: number, height: number): Uint8Array {
    const data = new Uint8Array(src.length);
    const rowBytes = width * 4;
    for (let y = 0; y < height; y++) {
      const srcRow = (height - 1 - y) * rowBytes;
      const dstRow = y * rowBytes;
      data.set(src.subarray(srcRow, srcRow + rowBytes), dstRow);
      for (let x = 0; x < width; x++) data[dstRow + x * 4 + 3] = 255;
    }
    return data;
  }

  private resize(width?: number, height?: number, force = false): void {
    const targetW = width ?? Math.max(1, Math.floor(this.canvas.clientWidth || 1280));
    const targetH = height ?? Math.max(1, Math.floor(this.canvas.clientHeight || 720));
    const size = new THREE.Vector2();
    this.renderer.getSize(size);
    if (!force && size.x === targetW && size.y === targetH) return;
    this.renderer.setSize(targetW, targetH, false);
    this.camera.aspect = targetW / Math.max(1, targetH);
    this.applyViewInset(targetW, targetH);
    this.camera.updateProjectionMatrix();
  }

  /** Recentre the orbit view on the area above a panel covering the bottom
   *  of the canvas (the calibration dock), so the model stays pickable. */
  setViewInsetBottom(pixels: number): void {
    const next = Math.max(0, Math.round(pixels));
    if (next === this.viewInsetBottom) return;
    this.viewInsetBottom = next;
    const size = new THREE.Vector2();
    this.renderer.getSize(size);
    this.applyViewInset(size.x, size.y);
    this.camera.updateProjectionMatrix();
  }

  private applyViewInset(width: number, height: number): void {
    // setViewOffset works in canvas pixels; the offset is in CSS pixels.
    const scale = height / Math.max(1, this.canvas.clientHeight || height);
    const shift = (this.recordingMode ? 0 : this.viewInsetBottom * scale) / 2;
    if (shift > 0) this.camera.setViewOffset(width, height, 0, shift, width, height);
    else this.camera.clearViewOffset();
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
      receiveProjection: sceneState.environment.showFloorProjection !== false,
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
    const surfaceStyle = this.currentScene?.environment.surfaceStyle;
    const parts = primitiveParts(object.primitive);
    const meshes = parts.map((part) => {
      const mesh = new THREE.Mesh(
        part.geometry,
        makeProjectionMaterial(part.tint ? { ...object, color: part.tint } : object, surfaceStyle),
      );
      mesh.position.y = part.offsetY;
      return mesh;
    });
    const built: THREE.Object3D = meshes.length === 1 ? meshes[0] : new THREE.Group().add(...meshes);
    this.prepareProjectedObject(built, object);
    return built;
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

  private makeImportedProjectionMaterial(
    object: ProjectionSimObject,
    sourceMaterial?: THREE.Material | null,
  ): ProjectionMaterial {
    const surfaceStyle = this.currentScene?.environment.surfaceStyle;
    const material = makeProjectionMaterial({ ...object, receiveProjection: true }, surfaceStyle, sourceMaterial);
    material.side = THREE.DoubleSide;

    // Imported models are mapping receivers first. In neutral receiver modes,
    // source transparency/alpha maps can make otherwise valid GLBs look blank.
    if (surfaceStyle !== 'original') {
      material.map = null;
      material.alphaMap = null;
      material.transparent = false;
      material.opacity = 1;
      material.alphaTest = 0;
    } else if (material.opacity <= 0.02) {
      material.transparent = false;
      material.opacity = 1;
    }

    material.needsUpdate = true;
    return material;
  }

  private async loadModel(object: ProjectionSimObject, holder: THREE.Group): Promise<void> {
    if (!object.assetUrl) return;
    const key = `${object.assetFormat ?? 'gltf'}:${object.assetUrl}`;
    let promise = this.modelCache.get(key);
    if (!promise) {
      promise = loadProjectionSimModel(object);
      this.modelCache.set(key, promise);
    }
    try {
      const loadedModel = await promise;
      if (!holder.parent) return;
      const loaded = SkeletonUtils.clone(loadedModel.scene);
      this.clearGroup(holder);
      normalizeImportedObject(loaded);
      loaded.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.userData.projectionSimSharedGeometry = true;
        mesh.castShadow = object.castShadow;
        mesh.receiveShadow = true;
        const sourceMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const projectionMaterials = sourceMaterials.map((sourceMaterial) =>
          this.makeImportedProjectionMaterial(object, sourceMaterial),
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

  private async loadPointCloud(object: ProjectionSimObject, holder: THREE.Group): Promise<void> {
    if (!object.assetUrl) return;
    try {
      const { geometry, hasFaces, dataType } = await loadProjectionSimPly(object.assetUrl);
      if (hasFaces) {
        const receiver = { ...object, receiveProjection: true, castShadow: object.castShadow };
        const material = this.makeImportedProjectionMaterial(receiver, null);
        if ((this.currentScene?.environment.surfaceStyle ?? 'light-gray') === 'original') {
          material.vertexColors = true;
        }
        material.needsUpdate = true;
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = object.assetName || object.name || 'PLY mesh';
        mesh.castShadow = object.castShadow;
        mesh.receiveShadow = true;
        this.clearGroup(holder);
        holder.add(mesh);
        this.prepareProjectedObject(mesh, receiver);
        this.lastDepthHash = '';
        this.lastShadowHash = '';
        return;
      }

      const pointSize = object.pointSize ?? (dataType === 'gaussian' ? 0.08 : 0.035);
      const points = new THREE.Points(
        geometry,
        new THREE.PointsMaterial({
          size: pointSize,
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
    // The lens sits at the group origin; the beam starts at the lens face.
    const origin = new THREE.Vector3(0, 0, 0);
    const corners = projectorFrustumCorners(projector, far).map((c) => new THREE.Vector3(c[0], c[1], c[2]));

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
    group.position.set(...projector.position);
    group.quaternion.setFromRotationMatrix(new THREE.Matrix4().fromArray(projectorWorldMatrix(projector)));
  }

  /** Roll that reproduces a projector body's orientation from a look-at
   *  pose, so rotating it with the gizmo keeps its twist. */
  private rollOf(quaternion: THREE.Quaternion, position: ProjectionSimVec3, target: ProjectionSimVec3): number {
    const x = new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion);
    return Math.round(projectorRollFromAxes(position, target, [x.x, x.y, x.z]) * 1000) / 1000;
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

  /** Point a camera along a projector's lens: pose with roll, and the
   *  lens-shifted projection the native projector view uses too. */
  private applyLensToCamera(camera: THREE.PerspectiveCamera, projector: ProjectionSimProjector): void {
    const world = new THREE.Matrix4().fromArray(projectorWorldMatrix(projector));
    camera.position.set(...projector.position);
    camera.quaternion.setFromRotationMatrix(world);
    camera.fov = projector.fov;
    camera.aspect = projector.aspect;
    camera.updateMatrixWorld(true);
    camera.projectionMatrix.fromArray(projectorProjectionMatrix(projector));
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  }

  private updateProjectorData(sceneState: ProjectionSimScene, outputSlices: OutputSlice[]): void {
    const enabled = sceneState.projectors.filter((p) => p.enabled).slice(0, MAX_PROJECTORS);
    const byId = new Map(sceneState.projectors.map((p) => [p.id, p]));
    const liveIds = new Set<string>();
    this.projectors.length = 0;

    // Depth slots: every lit projector, then any other lens a projector
    // takes its content from.
    const depthIds: string[] = enabled.map((p) => p.id);
    for (const projector of enabled) {
      const mapId = projector.contentFrom && byId.has(projector.contentFrom) ? projector.contentFrom : projector.id;
      if (!depthIds.includes(mapId) && depthIds.length < MAX_DEPTH_SLOTS) depthIds.push(mapId);
    }
    this.depthCameras = depthIds.map((id) => {
      const existing = this.depthCameras.find((entry) => entry.id === id);
      const camera = existing?.camera ?? new THREE.PerspectiveCamera(34, 16 / 9, 0.1, 120);
      this.applyLensToCamera(camera, byId.get(id)!);
      return { id, camera };
    });

    for (const projector of enabled) {
      liveIds.add(projector.id);
      let data = this.projectorDataById.get(projector.id);
      if (!data) {
        data = {
          id: projector.id,
          camera: new THREE.PerspectiveCamera(projector.fov, projector.aspect, 0.1, 120),
          matrix: new THREE.Matrix4(),
          position: new THREE.Vector3(),
          blend: ZERO_BLEND.clone(),
          tint: WHITE.clone(),
          opacity: projector.opacity,
          intensity: projector.intensity,
          depthSlot: 0,
          mapId: projector.id,
          mapMatrix: new THREE.Matrix4(),
          mapPosition: new THREE.Vector3(),
          mapCrop: DEFAULT_CROP.clone(),
          mapDepthSlot: 0,
        };
        this.projectorDataById.set(projector.id, data);
      }

      this.applyLensToCamera(data.camera, projector);
      data.matrix.multiplyMatrices(data.camera.projectionMatrix, data.camera.matrixWorldInverse);
      data.position.set(...projector.position);
      data.depthSlot = Math.max(0, depthIds.indexOf(projector.id));

      const mapping = (projector.contentFrom && byId.get(projector.contentFrom)) || projector;
      data.mapId = mapping.id;
      const mapCamera = this.depthCameras.find((entry) => entry.id === mapping.id)?.camera ?? data.camera;
      data.mapMatrix.multiplyMatrices(mapCamera.projectionMatrix, mapCamera.matrixWorldInverse);
      data.mapPosition.set(...mapping.position);
      data.mapCrop.set(...projectorContentCrop(mapping, outputSlices));
      data.mapDepthSlot = Math.max(0, depthIds.indexOf(mapping.id));
      data.blend.set(...projectorOutputBlend(projector, outputSlices));

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
    if (!this.depthCameras.length) {
      this.lastDepthHash = depthHash;
      return;
    }
    if (depthHash === this.lastDepthHash && this.depthAtlas) return;

    const atlas = this.getDepthAtlas();
    const previousTarget = this.renderer.getRenderTarget();
    const previousOverride = this.scene.overrideMaterial;
    const previousBackground = this.scene.background;
    const previousAutoClear = this.renderer.autoClear;
    const previousClearColor = this.renderer.getClearColor(new THREE.Color());
    const previousClearAlpha = this.renderer.getClearAlpha();
    const hidden = this.hideHelpers({ projectors: true, grid: true, calibration: true });

    this.scene.background = null;
    this.scene.overrideMaterial = this.depthMaterial;
    this.renderer.autoClear = false;
    // Packed depth 1.0 (nothing there) is white.
    this.renderer.setClearColor(0xffffff, 1);
    this.renderer.setRenderTarget(atlas);
    this.depthCameras.forEach((entry, slot) => {
      const x = (slot % DEPTH_ATLAS_COLUMNS) * DEPTH_TILE;
      const y = Math.floor(slot / DEPTH_ATLAS_COLUMNS) * DEPTH_TILE;
      atlas.viewport.set(x, y, DEPTH_TILE, DEPTH_TILE);
      atlas.scissor.set(x, y, DEPTH_TILE, DEPTH_TILE);
      atlas.scissorTest = true;
      this.renderer.setRenderTarget(atlas);
      this.renderer.clear(true, true, false);
      this.renderer.render(this.scene, entry.camera);
    });
    atlas.scissorTest = false;
    atlas.viewport.set(0, 0, atlas.width, atlas.height);
    atlas.scissor.set(0, 0, atlas.width, atlas.height);

    this.lastDepthHash = depthHash;

    this.renderer.setRenderTarget(previousTarget);
    this.renderer.setClearColor(previousClearColor, previousClearAlpha);
    this.scene.overrideMaterial = previousOverride;
    this.scene.background = previousBackground;
    this.renderer.autoClear = previousAutoClear;
    this.restoreHelpers(hidden);
  }

  private getDepthAtlas(): THREE.WebGLRenderTarget {
    if (!this.depthAtlas) {
      this.depthAtlas = new THREE.WebGLRenderTarget(DEPTH_TILE * DEPTH_ATLAS_COLUMNS, DEPTH_TILE * DEPTH_ATLAS_ROWS, {
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        depthBuffer: true,
        stencilBuffer: false,
      });
      this.depthAtlas.texture.name = 'ProjectionSimDepthAtlas';
      this.depthAtlas.texture.generateMipmaps = false;
    }
    return this.depthAtlas;
  }

  /** Hide editor helpers for an off-screen pass; returns what to restore. */
  private hideHelpers(opts: { projectors?: boolean; grid?: boolean; calibration?: boolean } = {}): THREE.Object3D[] {
    const hidden: THREE.Object3D[] = [];
    const hide = (object: THREE.Object3D | null | undefined) => {
      if (!object?.visible) return;
      object.visible = false;
      hidden.push(object);
    };
    hide(this.transformHelper);
    hide(this.selectionOutline);
    hide(this.multiSelectionBox);
    if (opts.projectors) hide(this.projectorRoot);
    if (opts.grid) hide(this.grid);
    if (opts.calibration) hide(this.calibrationRoot);
    return hidden;
  }

  private restoreHelpers(hidden: THREE.Object3D[]): void {
    for (const object of hidden) object.visible = true;
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
        this.uniformBlends[i].copy(projector.blend);
        this.uniformTints[i].copy(projector.tint);
        this.uniformOpacities[i] = projector.opacity;
        this.uniformIntensities[i] = Math.max(0, projector.intensity);
        this.uniformDepthSlots[i] = projector.depthSlot;
        this.uniformMapMatrices[i].copy(projector.mapMatrix);
        this.uniformMapPositions[i].copy(projector.mapPosition);
        this.uniformMapCrops[i].copy(projector.mapCrop);
        this.uniformMapDepthSlots[i] = projector.mapDepthSlot;
        this.uniformMapSelf[i] = projector.mapId === projector.id ? 1 : 0;
      } else {
        this.uniformMatrices[i].copy(IDENTITY);
        this.uniformPositions[i].set(0, 0, 0);
        this.uniformBlends[i].copy(ZERO_BLEND);
        this.uniformTints[i].copy(WHITE);
        this.uniformOpacities[i] = 0;
        this.uniformIntensities[i] = 1;
        this.uniformDepthSlots[i] = 0;
        this.uniformMapMatrices[i].copy(IDENTITY);
        this.uniformMapPositions[i].set(0, 0, 0);
        this.uniformMapCrops[i].copy(DEFAULT_CROP);
        this.uniformMapDepthSlots[i] = 0;
        this.uniformMapSelf[i] = 1;
      }
    }

    const atlas = this.depthAtlas?.texture ?? null;
    for (const material of this.projectionMaterials) {
      const shader = material.userData.projectionShader;
      if (!shader) continue;
      shader.uniforms.uProjectionTexture.value = this.sourceTexture;
      shader.uniforms.uProjectorCount.value = this.sourceTexture && atlas ? this.projectors.length : 0;
      shader.uniforms.uProjectorMatrices.value = this.uniformMatrices;
      shader.uniforms.uProjectorPositions.value = this.uniformPositions;
      shader.uniforms.uProjectorBlends.value = this.uniformBlends;
      shader.uniforms.uProjectorTints.value = this.uniformTints;
      shader.uniforms.uProjectorOpacities.value = this.uniformOpacities;
      shader.uniforms.uProjectorIntensities.value = this.uniformIntensities;
      shader.uniforms.uProjectorDepthSlots.value = this.uniformDepthSlots;
      shader.uniforms.uProjectorMapMatrices.value = this.uniformMapMatrices;
      shader.uniforms.uProjectorMapPositions.value = this.uniformMapPositions;
      shader.uniforms.uProjectorMapCrops.value = this.uniformMapCrops;
      shader.uniforms.uProjectorMapDepthSlots.value = this.uniformMapDepthSlots;
      shader.uniforms.uProjectorMapSelf.value = this.uniformMapSelf;
      shader.uniforms.uProjectorDepthAtlas.value = atlas;
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
        patch.roll = this.rollOf(obj.quaternion, patch.position!, patch.target);
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
        const nextQuaternion = deltaQuat.clone().multiply(item.quaternion);
        obj.position.copy(nextPosition);
        obj.quaternion.copy(nextQuaternion);
        this.onTransform(item.target, {
          position: arr3(nextPosition),
          target: arr3(nextTarget),
          roll: this.rollOf(nextQuaternion, arr3(nextPosition), arr3(nextTarget)),
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

    if (this.pickMode === 'calibrate') {
      const pick = this.pickModelPoint();
      if (pick) this.onModelPick?.(pick);
      return;
    }

    const helperHit = this.transformHelper.visible
      && this.raycaster.intersectObject(this.transformHelper, true)
        .some((hit) => this.isVisibleTransformHelperPart(hit.object));

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

    // TransformControls exposes broad helper planes, so normal scene picks need
    // priority or the first selected object can block future click selections.
    if (helperHit) return;

    if (!event.shiftKey && !event.metaKey && !event.ctrlKey) {
      this.onSelect(null, event);
    }
  };

  /** Exact surface point under the pointer on a visible object or the
   *  floor, snapped to the nearest corner of the hit triangle when that
   *  corner is within a few pixels. */
  private pickModelPoint(): ProjectionSimModelPick | null {
    const candidates: THREE.Object3D[] = [...this.selectable.entries()]
      .filter(([target, object]) => target.startsWith('object:') && object.visible)
      .map(([, object]) => object);
    const floor = this.root.children.find((child) => child.name === 'Projection floor');
    if (floor) candidates.push(floor);
    const hits = this.raycaster.intersectObjects(candidates, true).filter((hit) => {
      if (!(hit.object as THREE.Mesh).isMesh) return false;
      let current: THREE.Object3D | null = hit.object;
      while (current) {
        if (!current.visible) return false;
        current = current.parent;
      }
      return true;
    });
    const hit = hits[0];
    if (!hit) return null;
    const target = this.pickTargetFromObject(hit.object, 'object:');
    const objectId = target ? target.slice('object:'.length) : null;
    let point = hit.point.clone();
    let snapped = false;
    const mesh = hit.object as THREE.Mesh;
    const positions = mesh.geometry?.getAttribute('position');
    if (this.snapToVertices && hit.face && positions) {
      const from = this.worldToClient([hit.point.x, hit.point.y, hit.point.z]);
      let best = Infinity;
      for (const index of [hit.face.a, hit.face.b, hit.face.c]) {
        const vertex = new THREE.Vector3().fromBufferAttribute(positions as THREE.BufferAttribute, index).applyMatrix4(mesh.matrixWorld);
        const at = this.worldToClient([vertex.x, vertex.y, vertex.z]);
        if (!from || !at) continue;
        const distance = Math.hypot(at.x - from.x, at.y - from.y);
        if (distance < best && distance <= CALIBRATION_SNAP_PX) {
          best = distance;
          point = vertex;
          snapped = true;
        }
      }
    }
    const precise = (v: number) => Math.round(v * 1e5) / 1e5;
    return { world: [precise(point.x), precise(point.y), precise(point.z)], objectId, snapped };
  }

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

  private isVisibleTransformHelperPart(object: THREE.Object3D): boolean {
    let current: THREE.Object3D | null = object;
    while (current && current !== this.transformHelper) {
      if (!current.visible) return false;
      current = current.parent;
    }
    return true;
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
