/**
 * Keeps the native core's Map Sim projector views in step with the Map Sim
 * scene, from the main editor window (the window that owns the project and
 * the core connection). Runs only while some Screen shows a Map Sim
 * projector, so a rig without 3D mapping pays nothing.
 *
 * Geometry goes over once per mesh; the small view description (object
 * matrices, projector lenses) goes on every change. A slow heartbeat
 * re-sends the view so a restarted core, which reports its missing meshes,
 * is refilled without waiting for an edit.
 */
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { get } from 'svelte/store';
import { invoke } from '../bridge';
import { settings } from '../stores/settings';
import { projectionSimScene } from './store';
import type { ProjectionSimObject } from './types';
import { loadProjectionSimModel, loadProjectionSimPly, normalizeImportedObject } from './geometry';
import {
  FLOOR_MESH_KEY,
  buildProjectorViewScene,
  encodeProjectorViewMesh,
  floorMesh,
  meshFromObject3D,
  modelMeshKey,
  primitiveMesh,
  primitiveMeshKey,
  type ProjectorViewMesh,
} from './projectorViewPayload';

const HEARTBEAT_MS = 3000;
const FLUSH_DELAY_MS = 16;

function meshKeyFor(object: ProjectionSimObject): string | null {
  return object.type === 'primitive' ? primitiveMeshKey(object) : modelMeshKey(object);
}

export class ProjectionSimNativeViewSync {
  private meshes = new Map<string, ProjectorViewMesh | null>();
  private loading = new Set<string>();
  private uploaded = new Set<string>();
  private lastViewSig: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private flushing = false;
  private again = false;
  private unsubs: Array<() => void> = [];
  private stopped = false;

  start(): void {
    this.unsubs.push(projectionSimScene.subscribe(() => this.schedule()));
    this.unsubs.push(settings.subscribe(() => this.schedule()));
    this.heartbeat = setInterval(() => {
      if (this.lastViewSig === 'off' && !this.needed()) return;
      this.lastViewSig = null;
      this.schedule();
    }, HEARTBEAT_MS);
  }

  stop(): void {
    this.stopped = true;
    for (const unsub of this.unsubs) unsub();
    this.unsubs = [];
    if (this.timer) clearTimeout(this.timer);
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.timer = null;
    this.heartbeat = null;
  }

  private needed(): boolean {
    return (get(settings)?.output?.slices ?? []).some((slice) => !!slice.mapSimProjectorId);
  }

  private schedule(): void {
    if (this.stopped) return;
    if (this.flushing) {
      this.again = true;
      return;
    }
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, FLUSH_DELAY_MS);
  }

  private ensureMesh(object: ProjectionSimObject): void {
    const key = meshKeyFor(object);
    if (!key || this.meshes.has(key) || this.loading.has(key)) return;
    if (object.type === 'primitive') {
      this.meshes.set(key, primitiveMesh(object));
      return;
    }
    this.loading.add(key);
    void this.loadMesh(key, object)
      .then((mesh) => this.meshes.set(key, mesh))
      .catch((err) => {
        console.warn('[MapSimProjectorView] could not load geometry for', object.name, err);
        this.meshes.set(key, null);
      })
      .finally(() => {
        this.loading.delete(key);
        this.schedule();
      });
  }

  /** Imported geometry in the object's own space, normalised exactly as
   *  the preview does it. */
  private async loadMesh(key: string, object: ProjectionSimObject): Promise<ProjectorViewMesh | null> {
    const holder = new THREE.Group();
    if (object.type === 'pointcloud') {
      const { geometry, hasFaces } = await loadProjectionSimPly(object.assetUrl!);
      if (!hasFaces) {
        geometry.dispose();
        return null;
      }
      holder.add(new THREE.Mesh(geometry));
    } else {
      const loaded = await loadProjectionSimModel(object);
      const model = SkeletonUtils.clone(loaded.scene);
      holder.add(model);
      normalizeImportedObject(model);
    }
    return meshFromObject3D(key, holder);
  }

  private async flush(): Promise<void> {
    if (this.stopped) return;
    this.flushing = true;
    try {
      if (!this.needed()) {
        if (this.lastViewSig !== 'off') {
          await invoke('native_renderer_set_projection_sim_view', { view: null });
          await invoke('native_renderer_set_projection_sim_meshes', { meshes: [], retain: [] });
          this.uploaded.clear();
          this.lastViewSig = 'off';
        }
        return;
      }
      const scene = get(projectionSimScene);
      const slices = get(settings)?.output?.slices ?? [];
      if (!this.meshes.has(FLOOR_MESH_KEY)) this.meshes.set(FLOOR_MESH_KEY, floorMesh());
      for (const object of scene.objects) {
        if (object.visible) this.ensureMesh(object);
      }
      const ready = (object: ProjectionSimObject) => {
        const key = meshKeyFor(object);
        return key && this.meshes.get(key) ? key : null;
      };
      const view = buildProjectorViewScene(scene, slices, ready);
      const keys = [...new Set(view.objects.map((object) => object.mesh))];
      const toUpload = keys.filter((key) => !this.uploaded.has(key));
      if (toUpload.length) {
        await invoke('native_renderer_set_projection_sim_meshes', {
          meshes: toUpload.map((key) => encodeProjectorViewMesh(this.meshes.get(key)!)),
          retain: keys,
        });
        this.uploaded = new Set(keys);
      }
      const sig = JSON.stringify(view);
      if (sig !== this.lastViewSig) {
        const result = await invoke<{ missing_meshes?: string[] } | null>('native_renderer_set_projection_sim_view', { view });
        this.lastViewSig = sig;
        const missing = result?.missing_meshes ?? [];
        if (missing.length) {
          // The core lost them (a restart): send them again.
          for (const key of missing) this.uploaded.delete(key);
          this.lastViewSig = null;
          this.again = true;
        }
      }
    } catch (err) {
      // The core may be starting or stopping; the heartbeat retries.
      this.lastViewSig = null;
      console.warn('[MapSimProjectorView] sync failed', err);
    } finally {
      this.flushing = false;
      if (this.again) {
        this.again = false;
        this.schedule();
      }
    }
  }
}

export function startProjectionSimNativeViewSync(): () => void {
  const sync = new ProjectionSimNativeViewSync();
  sync.start();
  return () => sync.stop();
}
