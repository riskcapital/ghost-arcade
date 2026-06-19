import { get, writable } from 'svelte/store';
import type {
  ProjectionSimGizmoMode,
  ProjectionSimObject,
  ProjectionSimProjector,
  ProjectionSimScene,
  ProjectionSimSelection,
  ProjectionSimVec3,
} from './types';
import { createProjectionSimScene, makeProjectionSimPrimitive, makeProjectionSimProjector, type ProjectionSimPrimitiveKind } from './types';
import { buildProjectionSimPreset } from './presets';

const LEGACY_STORAGE_KEY = 'ga-projection-sim-scene';
const DEFAULT_ENVIRONMENT = createProjectionSimScene().environment;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function loadInitialScene(): ProjectionSimScene {
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch { /* private mode */ }
  return buildProjectionSimPreset('cube-pyramid') ?? createProjectionSimScene();
}

function normalizeScene(scene: ProjectionSimScene): ProjectionSimScene {
  return {
    ...scene,
    environment: {
      ...DEFAULT_ENVIRONMENT,
      ...(scene.environment ?? {}),
      roomExposure: scene.environment?.roomExposure ?? DEFAULT_ENVIRONMENT.roomExposure,
      surfaceStyle: scene.environment?.surfaceStyle ?? DEFAULT_ENVIRONMENT.surfaceStyle,
      shadowStrength: scene.environment?.shadowStrength ?? DEFAULT_ENVIRONMENT.shadowStrength,
    },
    objects: (scene.objects ?? []).map((object) => ({
      ...object,
      locked: object.locked ?? false,
    })),
    projectors: (scene.projectors ?? []).map((projector) => ({
      ...projector,
      locked: projector.locked ?? false,
      showFrustum: projector.showFrustum ?? true,
      aspect: projector.aspect || 16 / 9,
    })),
  };
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
  return next;
}

function createProjectionSimStore() {
  const { subscribe, set, update } = writable<ProjectionSimScene>(loadInitialScene());

  function setScene(scene: ProjectionSimScene) {
    set(scene);
    persist(scene, true);
  }

  return {
    subscribe,

    loadScene(scene: ProjectionSimScene) {
      setScene(normalizeScene(clone(scene)));
    },

    newScene() {
      setScene(createProjectionSimScene());
      selectedProjectionSimTarget.set(null);
    },

    loadPreset(id: string) {
      const preset = buildProjectionSimPreset(id);
      if (!preset) return false;
      setScene(preset);
      selectedProjectionSimTarget.set(null);
      return true;
    },

    setName(name: string) {
      update((scene) => {
        const next = { ...scene, name };
        persist(next);
        return next;
      });
    },

    addPrimitive(kind: ProjectionSimPrimitiveKind) {
      const obj = makeProjectionSimPrimitive(kind);
      update((scene) => {
        const next = { ...scene, objects: [...scene.objects, obj] };
        persist(next);
        return next;
      });
      selectedProjectionSimTarget.set(`object:${obj.id}`);
      return obj;
    },

    addImportedObject(object: ProjectionSimObject) {
      update((scene) => {
        const next = { ...scene, objects: [...scene.objects, object] };
        persist(next);
        return next;
      });
      selectedProjectionSimTarget.set(`object:${object.id}`);
    },

    setObjects(objects: ProjectionSimObject[]) {
      update((scene) => {
        const next = { ...scene, objects };
        persist(next);
        return next;
      });
    },

    updateObject(id: string, patch: Partial<ProjectionSimObject>) {
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
      update((scene) => {
        if (scene.objects.find((obj) => obj.id === id)?.locked) return scene;
        const next = { ...scene, objects: scene.objects.filter((obj) => obj.id !== id) };
        removed = next.objects.length !== scene.objects.length;
        persist(next, true);
        return next;
      });
      if (removed && get(selectedProjectionSimTarget) === `object:${id}`) selectedProjectionSimTarget.set(null);
    },

    addProjector() {
      const idx = get({ subscribe }).projectors.length + 1;
      const projector = makeProjectionSimProjector(`Projector ${idx}`, [-6 + (idx - 1) * 3, 4.5, 8], [0, 2, 0]);
      update((scene) => {
        const next = { ...scene, projectors: [...scene.projectors, projector] };
        persist(next);
        return next;
      });
      selectedProjectionSimTarget.set(`projector:${projector.id}`);
      return projector;
    },

    addProjectorFrom(projector: ProjectionSimProjector) {
      update((scene) => {
        const next = { ...scene, projectors: [...scene.projectors, projector] };
        persist(next);
        return next;
      });
      selectedProjectionSimTarget.set(`projector:${projector.id}`);
    },

    setProjectors(projectors: ProjectionSimProjector[]) {
      update((scene) => {
        const next = { ...scene, projectors };
        persist(next);
        return next;
      });
      selectedProjectionSimTarget.set(projectors[0] ? `projector:${projectors[0].id}` : null);
    },

    updateProjector(id: string, patch: Partial<ProjectionSimProjector>) {
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
      update((scene) => {
        if (scene.projectors.find((projector) => projector.id === id)?.locked) return scene;
        const next = { ...scene, projectors: scene.projectors.filter((projector) => projector.id !== id) };
        removed = next.projectors.length !== scene.projectors.length;
        persist(next, true);
        return next;
      });
      if (removed && get(selectedProjectionSimTarget) === `projector:${id}`) selectedProjectionSimTarget.set(null);
    },

    setEnvironment(patch: Partial<ProjectionSimScene['environment']>) {
      update((scene) => {
        const next = { ...scene, environment: { ...scene.environment, ...patch } };
        persist(next);
        return next;
      });
    },

    setCamera(camera: ProjectionSimScene['camera']) {
      update((scene) => {
        const next = { ...scene, camera };
        persist(next);
        return next;
      });
    },

    updateTargetTransform(target: ProjectionSimSelection, transform: { position?: ProjectionSimVec3; rotation?: ProjectionSimVec3; scale?: ProjectionSimVec3; target?: ProjectionSimVec3 }) {
      if (!target) return;
      const [kind, id] = target.split(':') as ['object' | 'projector', string];
      if (kind === 'object') {
        this.updateObject(id, transform);
      } else {
        const patch: Partial<ProjectionSimProjector> = {};
        if (transform.position) patch.position = transform.position;
        if (transform.target) patch.target = transform.target;
        this.updateProjector(id, patch);
      }
    },

    exportJSON(): string {
      return JSON.stringify(get({ subscribe }), null, 2);
    },

    importJSON(text: string): boolean {
      try {
        const data = JSON.parse(text);
        if (data?.schemaVersion === 1 && Array.isArray(data.objects) && Array.isArray(data.projectors)) {
          setScene(normalizeScene(data as ProjectionSimScene));
          selectedProjectionSimTarget.set(null);
          return true;
        }
      } catch { /* invalid */ }
      return false;
    },
  };
}

export const projectionSimScene = createProjectionSimStore();
export const selectedProjectionSimTarget = writable<ProjectionSimSelection>(null);
export const projectionSimGizmoMode = writable<ProjectionSimGizmoMode>('translate');
