import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildVenue } from './venues';

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
});
