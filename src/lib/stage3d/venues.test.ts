import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SPHERE_STAGE, buildVenue } from './venues';

describe('venue scenery', () => {
  it('keeps both festival PA cabinet envelopes clear of every tower and overhead truss', () => {
    const venue = buildVenue('festival');
    venue.group.updateMatrixWorld(true);
    const rig = venue.group.children.filter(o => /^(tower-|truss-|beam-)/.test(o.userData.sceneryId ?? ''));
    for (const id of ['pa-L', 'pa-R']) {
      const pa = venue.group.children.find(o => o.userData.sceneryId === id)!;
      const envelope = new THREE.Box3().setFromObject(pa).expandByScalar(0.25);
      expect(Math.abs(pa.position.x)).toBeLessThan(19);
      for (const part of rig) {
        expect(envelope.intersectsBox(new THREE.Box3().setFromObject(part)), `${id} intersects ${part.userData.sceneryId}`).toBe(false);
      }
    }
  });

  it.each(['festival', 'arena', 'club', 'nightclub', 'sphere'] as const)(
    '%s opens with a clear sightline to the screen', name => {
      const venue = buildVenue(name);
      venue.group.updateMatrixWorld(true);
      const origin = new THREE.Vector3(...venue.cameraPosition);
      const wall = venue.ledWall;
      for (const offset of [-0.25, 0, 0.25]) {
        const target = new THREE.Vector3(wall.centerX + wall.width * offset, wall.centerY, wall.centerZ);
        const ray = new THREE.Raycaster(origin, target.clone().sub(origin).normalize(), 0, origin.distanceTo(target) - 0.1);
        expect(ray.intersectObject(venue.group, true).length, `${name}: screen sightline ${offset}`).toBe(0);
      }
    },
  );

  it.each(['festival', 'arena', 'club', 'nightclub', 'sphere', 'empty'] as const)(
    '%s has finite scenery, valid geometry, and matching light baselines', name => {
      const venue = buildVenue(name);
      expect(venue.lights.length).toBe(venue.baselineIntensities.length);
      venue.group.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        const positions = object.geometry.getAttribute('position');
        expect(Array.from(positions.array).every(Number.isFinite)).toBe(true);
        const index = object.geometry.getIndex();
        if (index) {
          let valid = true;
          for (let i = 0; i < index.count; i++) {
            const vertex = index.getX(i);
            if (vertex < 0 || vertex >= positions.count) { valid = false; break; }
          }
          expect(valid).toBe(true);
        }
      });
    },
  );

  it('batches the detailed sphere auditorium into fewer than 50 meshes', () => {
    const venue = buildVenue('sphere');
    let meshes = 0;
    venue.group.traverse(o => { if (o instanceof THREE.Mesh) meshes++; });
    expect(meshes).toBeLessThan(50);
    expect(venue.ledDome).toBeDefined();
    expect(venue.defaultScreenTransform).toBeDefined();
  });

  it('gives the sphere a modest stage on the floor in front of the bowl', () => {
    const venue = buildVenue('sphere');
    venue.group.updateMatrixWorld(true);
    const stage = venue.group.children.find(o => o.userData.sceneryId === 'stage')!;
    expect(stage).toBeDefined();
    const box = new THREE.Box3().setFromObject(stage);
    // Sits on the floor, about deck height, a fraction of the dome's width.
    expect(box.min.y).toBeCloseTo(0, 3);
    expect(box.max.y).toBeGreaterThan(1.2);
    expect(box.max.y).toBeLessThan(2);
    expect(box.max.x - box.min.x).toBeLessThan(20);
    // Faces the seats: front edge well short of the first row (z = -32),
    // back edge inside the dome's base (radius ≈ 80 around z = 7).
    expect(box.max.z).toBeLessThan(-40);
    expect(box.min.z).toBeGreaterThan(7 - 80);
    expect(venue.frontZ).toBeCloseTo(SPHERE_STAGE.backZ + SPHERE_STAGE.depth, 6);
    // The front is bowed toward the audience: the centre reaches further
    // than the corners.
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 0.5, 0), new THREE.Vector3(0, 0, -1));
    const centreHit = ray.intersectObject(stage, true)[0];
    ray.set(new THREE.Vector3(SPHERE_STAGE.width / 2 - 0.3, 0.5, 0), new THREE.Vector3(0, 0, -1));
    const cornerHit = ray.intersectObject(stage, true)[0];
    expect(centreHit.point.z).toBeGreaterThan(cornerHit.point.z + 1);
  });
});
