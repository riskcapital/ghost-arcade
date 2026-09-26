import { get, writable } from 'svelte/store';
import { recordMissingAsset, resolveAssetRefForRuntime } from '../storage/assetRegistry';
import type {
  ProjectionSimCalibration,
  ProjectionSimGizmoMode,
  ProjectionSimObject,
  ProjectionSimProjector,
  ProjectionSimScene,
  ProjectionSimSelection,
  ProjectionSimVec3,
} from './types';
import { DEFAULT_PROJECTOR_FAR, DEFAULT_PROJECTOR_NEAR, projectorImageSize } from './projectorLens';
import { createProjectionSimScene, makeProjectionSimPrimitive, makeProjectionSimProjector, type ProjectionSimPrimitiveKind } from './types';
import { buildProjectionSimPreset } from './presets';

const LEGACY_STORAGE_KEY = 'ga-projection-sim-scene';
const DEFAULT_ENVIRONMENT = createProjectionSimScene().environment;
const MAX_HISTORY = 100;
const HISTORY_COALESCE_MS = 400;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function loadInitialScene(): ProjectionSimScene {
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch { /* private mode */ }
  return buildProjectionSimPreset('cube-pyramid') ?? createProjectionSimScene();
}

function normalizeScene(scene: ProjectionSimScene, projectDir?: string): ProjectionSimScene {
  return {
    ...scene,
    environment: {
      ...DEFAULT_ENVIRONMENT,
      ...(scene.environment ?? {}),
      roomExposure: scene.environment?.roomExposure ?? DEFAULT_ENVIRONMENT.roomExposure,
      surfaceStyle: scene.environment?.surfaceStyle ?? DEFAULT_ENVIRONMENT.surfaceStyle,
      showFloorProjection: scene.environment?.showFloorProjection ?? DEFAULT_ENVIRONMENT.showFloorProjection,
      shadowStrength: scene.environment?.shadowStrength ?? DEFAULT_ENVIRONMENT.shadowStrength,
    },
    objects: (scene.objects ?? []).map((object) => {
      const assetUrl = resolveAssetRefForRuntime(object.assetRef, projectDir, object.assetUrl) ?? object.assetUrl;
      if (object.assetRef && !assetUrl) {
        recordMissingAsset({ assetRef: object.assetRef, fieldHint: '3D model (Map Sim)' });
      }
      return {
        ...object,
        locked: object.locked ?? false,
        receiveProjection: object.receiveProjection ?? true,
        assetUrl,
      };
    }),
    projectors: (scene.projectors ?? []).map((projector) => normalizeProjector(projector)),
  };
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeCalibration(projector: ProjectionSimProjector): ProjectionSimCalibration | undefined {
  const calibration = projector.calibration;
  if (!calibration) return undefined;
  const size = calibration.imageSize;
  const imageSize: [number, number] = size && size[0] > 0 && size[1] > 0
    ? [Math.round(size[0]), Math.round(size[1])]
    : projectorImageSize({ ...projector, calibration: undefined });
  return {
    imageSize,
    fixedIntrinsics: !!calibration.fixedIntrinsics,
    points: (calibration.points ?? [])
      .filter((point) => point && typeof point.id === 'string' && Array.isArray(point.world) && point.world.every(Number.isFinite))
      .map((point) => ({
        id: point.id,
        world: [point.world[0], point.world[1], point.world[2]] as ProjectionSimVec3,
        image: Array.isArray(point.image) && point.image.every(Number.isFinite)
          ? [point.image[0], point.image[1]] as [number, number]
          : null,
        objectId: point.objectId ?? null,
        enabled: point.enabled !== false,
      })),
    result: calibration.result ?? null,
  };
}

/** Fill lens and calibration fields on projectors saved before they existed. */
function normalizeProjector(projector: ProjectionSimProjector): ProjectionSimProjector {
  const shift = projector.lensShift;
  const next: ProjectionSimProjector = {
    ...projector,
    locked: projector.locked ?? false,
    showFrustum: projector.showFrustum ?? true,
    aspect: projector.aspect || 16 / 9,
    lensShift: [finite(shift?.[0], 0), finite(shift?.[1], 0)],
    roll: finite(projector.roll, 0),
    near: finite(projector.near, DEFAULT_PROJECTOR_NEAR),
    far: finite(projector.far, DEFAULT_PROJECTOR_FAR),
    contentFrom: projector.contentFrom ?? null,
  };
  const calibration = normalizeCalibration(projector);
  if (calibration) next.calibration = calibration;
  else delete next.calibration;
  return next;
}

function persist(scene: ProjectionSimScene, immediate = false): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = null;
  void scene;
  void immediate;
}

export function isProjectionSimTargetLocked(scene: ProjectionSimScene, target: ProjectionSimSelection): boolean {
  if (!target) return false;
  const [kind, id] = target.split(':') as ['object' | 'projector', string];
  if (kind === 'object') return scene.objects.find((object) => object.id === id)?.locked ?? false;
  return scene.projectors.find((projector) => projector.id === id)?.locked ?? false;
}

function objectPatchWithoutTransform(patch: Partial<ProjectionSimObject>): Partial<ProjectionSimObject> {
  const next = { ...patch };
  delete next.position;
  delete next.rotation;
  delete next.scale;
  return next;
}

function projectorPatchWithoutTransform(patch: Partial<ProjectionSimProjector>): Partial<ProjectionSimProjector> {
  const next = { ...patch };
  delete next.position;
  delete next.target;
  delete next.roll;
  return next;
}

function sceneHasTarget(scene: ProjectionSimScene, target: ProjectionSimSelection): boolean {
  if (!target) return false;
  const [kind, id] = target.split(':') as ['object' | 'projector', string];
  return kind === 'object'
    ? scene.objects.some((object) => object.id === id)
    : scene.projectors.some((projector) => projector.id === id);
}

function createProjectionSimStore() {
  const { subscribe, set, update } = writable<ProjectionSimScene>(loadInitialScene());
  const past: ProjectionSimScene[] = [];
  const future: ProjectionSimScene[] = [];
  let suppressSnapshot = false;
  let lastSnapshotAt = 0;
  let applyingRemote = false;

  function setScene(scene: ProjectionSimScene) {
    set(scene);
    persist(scene, true);
  }

  function bumpHistoryVersion() {
    projectionSimHistoryVersion.update((value) => value + 1);
  }

  function snapshot(options: { coalesce?: boolean } = {}) {
    if (suppressSnapshot) return;
    const coalesce = options.coalesce !== false;
    const now = nowMs();
    if (coalesce && now - lastSnapshotAt < HISTORY_COALESCE_MS) {
      lastSnapshotAt = now;
      future.length = 0;
      bumpHistoryVersion();
      return;
    }

    past.push(clone(get({ subscribe })));
    if (past.length > MAX_HISTORY) past.shift();
    future.length = 0;
    lastSnapshotAt = coalesce ? now : 0;
    bumpHistoryVersion();
  }

  function restoreScene(scene: ProjectionSimScene) {
    suppressSnapshot = true;
    setScene(scene);
    suppressSnapshot = false;
    lastSnapshotAt = 0;
    const selected = get(selectedProjectionSimTarget);
    if (selected && !sceneHasTarget(scene, selected)) {
      setProjectionSimSelection(null);
    } else {
      const validTargets = [...get(selectedProjectionSimTargets)].filter((target) => sceneHasTarget(scene, target));
      setProjectionSimMultiSelection(validTargets);
    }
    bumpHistoryVersion();
  }

  return {
    subscribe,

    loadScene(scene: ProjectionSimScene) {
      snapshot({ coalesce: false });
      setScene(normalizeScene(clone(scene)));
      setProjectionSimSelection(null);
    },

    /** Project-open restore. Unlike loadScene this resets undo history and
     *  does NOT bump the history version — a freshly opened project must not
     *  read as having unsaved sim edits. */
    loadSceneFromProject(scene: ProjectionSimScene, projectDir?: string) {
      past.length = 0;
      future.length = 0;
      lastSnapshotAt = 0;
      setScene(normalizeScene(clone(scene), projectDir));
      setProjectionSimSelection(null);
    },

    /** Save-time serializer: runtime blob/asset URLs are session-scoped, so
     *  blank them whenever the durable AssetRef can reproduce them on load. */
    exportForProject(): ProjectionSimScene {
      const scene = clone(get({ subscribe }));
      for (const object of scene.objects) {
        const ref = object.assetRef;
        if (ref && (ref.originalPath || ref.projectPath || ref.dataUrl || ref.url)) {
          object.assetUrl = '';
        }
      }
      return scene;
    },

    newScene() {
      snapshot({ coalesce: false });
      setScene(createProjectionSimScene());
      setProjectionSimSelection(null);
    },

    loadPreset(id: string) {
      const preset = buildProjectionSimPreset(id);
      if (!preset) return false;
      snapshot({ coalesce: false });
      setScene(preset);
      setProjectionSimSelection(null);
      return true;
    },

    setName(name: string) {
      snapshot();
      update((scene) => {
        const next = { ...scene, name };
        persist(next);
        return next;
      });
    },

    addPrimitive(kind: ProjectionSimPrimitiveKind) {
      const obj = makeProjectionSimPrimitive(kind);
      snapshot({ coalesce: false });
      update((scene) => {
        const next = { ...scene, objects: [...scene.objects, obj] };
        persist(next);
        return next;
      });
      setProjectionSimSelection(`object:${obj.id}`);
      return obj;
    },

    addImportedObject(object: ProjectionSimObject) {
      snapshot({ coalesce: false });
      update((scene) => {
        const next = { ...scene, objects: [...scene.objects, object] };
        persist(next);
        return next;
      });
      setProjectionSimSelection(`object:${object.id}`);
    },

    setObjects(objects: ProjectionSimObject[]) {
      snapshot({ coalesce: false });
      update((scene) => {
        const next = { ...scene, objects };
        persist(next);
        return next;
      });
    },

    updateObject(id: string, patch: Partial<ProjectionSimObject>) {
      snapshot();
      update((scene) => {
        const next = {
          ...scene,
          objects: scene.objects.map((obj) => {
            if (obj.id !== id) return obj;
            const guardedPatch = obj.locked
              ? objectPatchWithoutTransform(patch)
              : patch;
            return { ...obj, ...guardedPatch };
          }),
        };
        persist(next);
        return next;
      });
    },

    toggleObjectLock(id: string) {
      snapshot({ coalesce: false });
      update((scene) => {
        const next = {
          ...scene,
          objects: scene.objects.map((obj) => obj.id === id ? { ...obj, locked: !obj.locked } : obj),
        };
        persist(next, true);
        return next;
      });
    },

    removeObject(id: string) {
      let removed = false;
      snapshot({ coalesce: false });
      update((scene) => {
        if (scene.objects.find((obj) => obj.id === id)?.locked) return scene;
        const next = { ...scene, objects: scene.objects.filter((obj) => obj.id !== id) };
        removed = next.objects.length !== scene.objects.length;
        persist(next, true);
        return next;
      });
      if (removed) removeProjectionSimTargetFromSelection(`object:${id}`);
    },

    addProjector() {
      const idx = get({ subscribe }).projectors.length + 1;
      const projector = makeProjectionSimProjector(`Projector ${idx}`, [-6 + (idx - 1) * 3, 4.5, 8], [0, 2, 0]);
      snapshot({ coalesce: false });
      update((scene) => {
        const next = { ...scene, projectors: [...scene.projectors, projector] };
        persist(next);
        return next;
      });
      setProjectionSimSelection(`projector:${projector.id}`);
      return projector;
    },

    addProjectorFrom(projector: ProjectionSimProjector) {
      snapshot({ coalesce: false });
      update((scene) => {
        const next = { ...scene, projectors: [...scene.projectors, projector] };
        persist(next);
        return next;
      });
      setProjectionSimSelection(`projector:${projector.id}`);
    },

    setProjectors(projectors: ProjectionSimProjector[]) {
      snapshot({ coalesce: false });
      update((scene) => {
        const next = { ...scene, projectors };
        persist(next);
        return next;
      });
      setProjectionSimSelection(projectors[0] ? `projector:${projectors[0].id}` : null);
    },

    updateProjector(id: string, patch: Partial<ProjectionSimProjector>) {
      snapshot();
      update((scene) => {
        const next = {
          ...scene,
          projectors: scene.projectors.map((projector) => {
            if (projector.id !== id) return projector;
            const guardedPatch = projector.locked
              ? projectorPatchWithoutTransform(patch)
              : patch;
            return { ...projector, ...guardedPatch };
          }),
        };
        persist(next);
        return next;
      });
    },

    toggleProjectorLock(id: string) {
      snapshot({ coalesce: false });
      update((scene) => {
        const next = {
          ...scene,
          projectors: scene.projectors.map((projector) => projector.id === id ? { ...projector, locked: !projector.locked } : projector),
        };
        persist(next, true);
        return next;
      });
    },

    removeProjector(id: string) {
      let removed = false;
      snapshot({ coalesce: false });
      update((scene) => {
        if (scene.projectors.find((projector) => projector.id === id)?.locked) return scene;
        const next = { ...scene, projectors: scene.projectors.filter((projector) => projector.id !== id) };
        removed = next.projectors.length !== scene.projectors.length;
        persist(next, true);
        return next;
      });
      if (removed) removeProjectionSimTargetFromSelection(`projector:${id}`);
    },

    setEnvironment(patch: Partial<ProjectionSimScene['environment']>) {
      snapshot();
      update((scene) => {
        const next = { ...scene, environment: { ...scene.environment, ...patch } };
        persist(next);
        return next;
      });
    },

    setCamera(camera: ProjectionSimScene['camera']) {
      snapshot();
      update((scene) => {
        const next = { ...scene, camera };
        persist(next);
        return next;
      });
    },

    updateTargetTransform(target: ProjectionSimSelection, transform: { position?: ProjectionSimVec3; rotation?: ProjectionSimVec3; scale?: ProjectionSimVec3; target?: ProjectionSimVec3; roll?: number }) {
      if (!target) return;
      const [kind, id] = target.split(':') as ['object' | 'projector', string];
      if (kind === 'object') {
        this.updateObject(id, transform);
      } else {
        const patch: Partial<ProjectionSimProjector> = {};
        if (transform.position) patch.position = transform.position;
        if (transform.target) patch.target = transform.target;
        if (typeof transform.roll === 'number') patch.roll = transform.roll;
        this.updateProjector(id, patch);
      }
    },

    /** Point-matching calibration edit: one undo step that updates the
     *  calibration record and, when a solve lands, the projector's pose and
     *  lens together. A locked projector keeps its pose. */
    updateCalibration(
      id: string,
      updater: (calibration: ProjectionSimCalibration, projector: ProjectionSimProjector) => ProjectionSimCalibration,
      projectorPatch?: Partial<ProjectionSimProjector>,
    ) {
      snapshot({ coalesce: false });
      update((scene) => {
        const next = {
          ...scene,
          projectors: scene.projectors.map((projector) => {
            if (projector.id !== id) return projector;
            const current = projector.calibration ?? {
              imageSize: projectorImageSize(projector),
              fixedIntrinsics: false,
              points: [],
              result: null,
            };
            const calibration = updater(clone(current), projector);
            const patch = projectorPatch
              ? (projector.locked ? projectorPatchWithoutTransform(projectorPatch) : projectorPatch)
              : {};
            return { ...projector, ...patch, calibration };
          }),
        };
        persist(next);
        return next;
      });
    },

    /** A scene edited in another window (the Map Sim pop-out, or the editor
     *  after a project load). Not an undo step here; it is one in the window
     *  that made it. */
    applyRemoteScene(scene: ProjectionSimScene) {
      applyingRemote = true;
      try {
        setScene(normalizeScene(clone(scene)));
      } finally {
        applyingRemote = false;
      }
      const selected = get(selectedProjectionSimTarget);
      if (selected && !sceneHasTarget(get({ subscribe }), selected)) setProjectionSimSelection(null);
      bumpHistoryVersion();
    },

    isApplyingRemote(): boolean {
      return applyingRemote;
    },

    exportJSON(): string {
      return JSON.stringify(get({ subscribe }), null, 2);
    },

    importJSON(text: string): boolean {
      try {
        const data = JSON.parse(text);
        if (data?.schemaVersion === 1 && Array.isArray(data.objects) && Array.isArray(data.projectors)) {
          snapshot({ coalesce: false });
          setScene(normalizeScene(data as ProjectionSimScene));
          setProjectionSimSelection(null);
          return true;
        }
      } catch { /* invalid */ }
      return false;
    },

    undo() {
      const previous = past.pop();
      if (!previous) return false;
      future.push(clone(get({ subscribe })));
      if (future.length > MAX_HISTORY) future.shift();
      restoreScene(previous);
      return true;
    },

    redo() {
      const next = future.pop();
      if (!next) return false;
      past.push(clone(get({ subscribe })));
      if (past.length > MAX_HISTORY) past.shift();
      restoreScene(next);
      return true;
    },

    getHistoryCounts() {
      return { past: past.length, future: future.length };
    },
  };
}

export const projectionSimHistoryVersion = writable<number>(0);
export const projectionSimScene = createProjectionSimStore();
export const selectedProjectionSimTarget = writable<ProjectionSimSelection>(null);
export const selectedProjectionSimTargets = writable<Set<NonNullable<ProjectionSimSelection>>>(new Set());
export const projectionSimGizmoMode = writable<ProjectionSimGizmoMode>('translate');

export function setProjectionSimSelection(target: ProjectionSimSelection): void {
  selectedProjectionSimTarget.set(target);
  selectedProjectionSimTargets.set(target ? new Set([target]) : new Set());
}

export function toggleProjectionSimSelection(target: NonNullable<ProjectionSimSelection>): void {
  const current = new Set(get(selectedProjectionSimTargets));
  if (current.has(target)) {
    current.delete(target);
    if (get(selectedProjectionSimTarget) === target) {
      const remaining = [...current];
      selectedProjectionSimTarget.set(remaining[remaining.length - 1] ?? null);
    }
  } else {
    current.add(target);
    selectedProjectionSimTarget.set(target);
  }
  selectedProjectionSimTargets.set(current);
}

export function setProjectionSimMultiSelection(targets: NonNullable<ProjectionSimSelection>[]): void {
  selectedProjectionSimTargets.set(new Set(targets));
  selectedProjectionSimTarget.set(targets[targets.length - 1] ?? null);
}

export function removeProjectionSimTargetFromSelection(target: NonNullable<ProjectionSimSelection>): void {
  const current = new Set(get(selectedProjectionSimTargets));
  current.delete(target);
  selectedProjectionSimTargets.set(current);
  if (get(selectedProjectionSimTarget) === target) {
    const remaining = [...current];
    selectedProjectionSimTarget.set(remaining[remaining.length - 1] ?? null);
  }
}
