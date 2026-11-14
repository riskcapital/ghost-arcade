/**
 * The world as a ghost-scene the 3D engine draws, from its geometry
 * (worldGeometry.ts): the wall relief as relief.ts builds it, or a room's
 * faces, each an outline mesh turned onto its plane, over a ground that
 * catches shadows.
 *
 * With the "Effects only" look every surface is a catcher: only the light
 * thrown on it, the paint on it and the shadows it receives are drawn, so
 * on real objects only the effects show.
 */
import type { InteractiveScene } from '../mobile/studio/interactive';
import { add, cross, dot, length, normalize, scale, sub } from './roomModel';
import { finishMaterial, node, reliefScene, sunDirection, type ReliefView } from './relief';
import { defaultScene3D, material, type Scene3D, type SceneNode, type Vec3 } from './sceneModel';
import { basisEuler, upOf, type WorldGeo } from './worldGeometry';
import type { ReliefWorld } from './worldModel';

/** Turns `v` about unit `axis` by `deg` degrees. */
function turn(v: Vec3, axis: Vec3, deg: number): Vec3 {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return add(add(scale(v, c), scale(cross(axis, v), s)), scale(axis, dot(axis, v) * (1 - c)));
}

/** The camera: the projector itself, or turned round the room's middle. */
export function roomCamera(geo: WorldGeo, view?: ReliefView): Scene3D['camera'] {
  const pr = geo.projector;
  if (!view || (!view.yaw && !view.pitch)) return { mode: 'free', fov: pr.fov, position: [...pr.pos] as Vec3, target: add(pr.pos, pr.fwd) };
  const yaw = Math.max(-80, Math.min(80, view.yaw)), pitch = Math.max(-80, Math.min(80, view.pitch));
  let off = sub(pr.pos, geo.center);
  off = turn(off, [0, 1, 0], yaw);
  const side = normalize(cross([0, 1, 0], off));
  if (length(side) > 0.5) off = turn(off, side, -pitch);
  return { mode: 'free', fov: pr.fov, position: add(geo.center, off), target: [...geo.center] as Vec3 };
}

function roomScene(scene: InteractiveScene, world: ReliefWorld, geo: WorldGeo, view?: ReliefView): Scene3D {
  const effectsOnly = world.look === 'effects';
  const nodes: SceneNode[] = [];
  const up = upOf(geo);
  const size = Math.max(2, geo.radius);
  if (geo.plane) {
    // The ground: a unit plane (normal +Y) turned to face up, under the room's middle.
    const n = geo.plane.n;
    let x = cross(n, geo.projector.fwd);
    if (length(x) < 1e-3) x = cross(n, [1, 0, 0]);
    x = normalize(x);
    const z = normalize(cross(x, n));
    const at = sub(geo.center, scale(n, dot(geo.center, n) - geo.plane.offset));
    nodes.push(node('ground', 'Ground', {
      kind: 'mesh', shape: 'plane', material: material('matte', { base: world.wall.color, rough: world.wall.rough }),
      collider: 'static', catcher: world.wall.catcher || effectsOnly,
    }, { position: at, rotation: basisEuler(x, n, z), scale: [size * 2, 1, size * 2] }));
  }
  {
    // The backdrop: a wall behind everything, square to the projector and
    // filling its view, so what the projector throws past the objects (the
    // 2D effects, shadows) still lands somewhere, as it does on a real wall.
    const pr = geo.projector;
    const far = geo.spawnRef + Math.max(1, geo.radius * 0.5);
    const n = scale(pr.fwd, -1);
    const x = normalize(pr.right);
    const span = far * (length(pr.right) + length(pr.up) + Math.abs(pr.shift[0]) + Math.abs(pr.shift[1])) * 3;
    nodes.push(node('backdrop', 'Backdrop', {
      kind: 'mesh', shape: 'plane', material: material('matte', { base: world.wall.color, rough: world.wall.rough }),
      collider: 'none', catcher: world.wall.catcher || effectsOnly,
    }, { position: add(pr.pos, scale(pr.fwd, far)), rotation: basisEuler(x, n, normalize(cross(x, n))), scale: [span, 1, span] }));
  }
  for (const f of geo.faces) {
    nodes.push(node(`block:${f.surfaceId}`, f.name, {
      kind: 'mesh', shape: 'outline', material: finishMaterial(f.finish), collider: 'static',
      catcher: effectsOnly || f.finish?.preset === 'light', outline: { points: f.points, depth: f.depth },
    }, { position: [...f.origin] as Vec3, rotation: basisEuler(f.u, f.v, f.n) }));
  }
  // The sun as on the wall, with the wall's axes taken from the projector:
  // across its view, up, and back towards it.
  const across = normalize(geo.projector.right);
  const back = normalize(sub(scale(geo.projector.fwd, -1), scale(up, dot(scale(geo.projector.fwd, -1), up))));
  const s = sunDirection(world.sun.azimuth, world.sun.elevation);
  nodes.push(node('sun', 'Sun', { kind: 'light', light: 'key', color: world.sun.color, power: world.sun.power, shadows: true, orbit: 0 }, {
    position: add(add(scale(across, s[0]), scale(up, s[1])), scale(length(back) > 0.5 ? back : [0, 0, 1], s[2])),
  }));
  if (world.fill.power > 0) {
    nodes.push(node('fill', 'Fill', { kind: 'light', light: 'point', color: world.fill.color, power: world.fill.power * 6, shadows: false, orbit: 0 }, {
      position: add(geo.center, add(scale(across, size * 0.4), add(scale(up, -size * 0.15), scale(back, size * 0.35)))),
    }));
  }
  const base = defaultScene3D();
  return {
    ...base,
    name: 'Room',
    nodes,
    environment: { sky: 'void', intensity: 0.35, fog: 0 },
    camera: roomCamera(geo, view),
    post: { ...base.post, bloom: world.bloom, exposure: world.exposure },
    react: { light: 0.25, particles: 0.3, bloom: 0.35, camera: 0 },
  };
}

export function worldScene(scene: InteractiveScene, world: ReliefWorld, geo: WorldGeo, aspect: number, view?: ReliefView): Scene3D {
  return geo.mode === 'room' ? roomScene(scene, world, geo, view) : reliefScene(scene, world, aspect, view);
}
