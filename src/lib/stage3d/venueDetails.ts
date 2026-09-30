import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

type Box = { size: [number, number, number]; at: [number, number, number]; yaw?: number };

/** Static scenery is batched by finish, not one draw call per seat or slat. */
function boxes(items: Box[], color: number, glow = false): THREE.Mesh {
  const rotation = new THREE.Quaternion();
  const matrix = new THREE.Matrix4();
  const parts = items.map(item => {
    rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), item.yaw ?? 0);
    matrix.compose(new THREE.Vector3(...item.at), rotation, new THREE.Vector3(...item.size));
    return new THREE.BoxGeometry(1, 1, 1).applyMatrix4(matrix);
  });
  const geometry = mergeGeometries(parts)!;
  parts.forEach(part => part.dispose());
  const material = new THREE.MeshStandardMaterial({
    color, roughness: glow ? 0.55 : 0.78, metalness: 0.15,
    emissive: glow ? color : 0, emissiveIntensity: glow ? 0.65 : 0,
  });
  const result = new THREE.Mesh(geometry, material);
  result.receiveShadow = !glow;
  return result;
}

export function stageDetails(width: number, frontZ: number, height: number): THREE.Group {
  const group = new THREE.Group();
  group.userData.sceneryId = 'stage-details';
  const dark: Box[] = [], metal: Box[] = [], marks: Box[] = [];
  // Two usable stair flights, with continuous treads and a landing at deck level.
  for (const side of [-1, 1]) {
    const x = side * (width / 2 - 1.6);
    for (let step = 0; step < 5; step++) {
      const h = height * (step + 1) / 5;
      const z = frontZ + (4 - step) * 0.4 + 0.2;
      dark.push({ size: [2.1, h, 0.4], at: [x, h / 2, z] });
      marks.push({ size: [1.95, 0.025, 0.035], at: [x, h + 0.013, z + 0.18] });
    }
    // Ground subs stay below the sightline and clear of access stairs.
    for (let i = 0; i < 3; i++) {
      const sx = side * (width / 2 - 7.5 + i * 1.4);
      dark.push({ size: [1.3, 0.95, 1.2], at: [sx, 0.475, frontZ + 1] });
      metal.push({ size: [1.16, 0.75, 0.04], at: [sx, 0.48, frontZ + 1.62] });
    }
  }
  for (const x of [-0.29, -0.1, 0.1, 0.29].map(t => t * width)) {
    dark.push({ size: [1.15, 0.38, 0.8], at: [x, height + 0.27, frontZ - 0.8] });
    metal.push({ size: [1.02, 0.04, 0.64], at: [x, height + 0.48, frontZ - 0.8] });
  }
  // Modular deck seams and understated blue downstage trim.
  for (let x = -width / 2 + 2; x < width / 2; x += 2) {
    dark.push({ size: [0.012, 0.012, 8], at: [x, height + 0.151, frontZ - 4] });
  }
  marks.push({ size: [width - 5.6, 0.045, 0.04], at: [0, height, frontZ + 0.13] });
  group.add(boxes(dark, 0x0a0d12), boxes(metal, 0x242c36), boxes(marks, 0x527baa, true));
  return group;
}

export function bowlSeats(centerZ: number, radius: number, y: number, rows: number,
  depth: number, rise: number, halfAngle: number): THREE.Group {
  const group = new THREE.Group();
  const seats: Box[] = [], backs: Box[] = [], aisleLights: Box[] = [];
  const sectionWidth = (halfAngle * 2 - 9) / 4;
  for (let row = 0; row < rows; row++) {
    const r = radius + row * depth + depth * 0.58;
    const level = y + (row + 1) * rise;
    for (let section = 0; section < 4; section++) {
      const start = -halfAngle + section * (sectionWidth + 3);
      const count = Math.max(2, Math.floor(THREE.MathUtils.degToRad(sectionWidth) * r / 0.78));
      for (let seat = 0; seat < count; seat++) {
        const a = THREE.MathUtils.degToRad(start + (seat + 0.5) * sectionWidth / count);
        seats.push({ size: [0.56, 0.12, 0.5], at: [r * Math.sin(a), level + 0.34, centerZ + r * Math.cos(a)], yaw: a });
        backs.push({ size: [0.56, 0.52, 0.12], at: [(r + 0.23) * Math.sin(a), level + 0.61, centerZ + (r + 0.23) * Math.cos(a)], yaw: a });
      }
      if (section < 3) {
        const a = THREE.MathUtils.degToRad(start + sectionWidth + 1.5);
        aisleLights.push({ size: [0.5, 0.025, 0.1], at: [r * Math.sin(a), level + 0.03, centerZ + r * Math.cos(a)], yaw: a });
      }
    }
  }
  group.add(boxes(seats, 0x111722), boxes(backs, 0x1b2230), boxes(aisleLights, 0x9d7744, true));
  return group;
}

export function roomDetails(width: number, depth: number, height: number, nightclub: boolean): THREE.Group {
  const group = new THREE.Group();
  group.userData.sceneryId = 'architectural-details';
  const panels: Box[] = [], trim: Box[] = [];
  // Coffered ceiling and recessed wall bays give the room depth even
  // when the house lights are low. Keep the central performance view open.
  for (let z = -depth / 2 + 3; z < depth / 2; z += 4) {
    panels.push({ size: [width - 1, 0.35, 0.24], at: [0, height - 0.3, z] });
  }
  for (const side of [-1, 1]) {
    for (let z = -depth / 2 + 6; z < depth / 2 - 4; z += 6) {
      panels.push({ size: [0.45, height - 1, 0.65], at: [side * (width / 2 - 0.4), (height - 1) / 2, z] });
      trim.push({ size: [0.04, 0.5, 0.35], at: [side * (width / 2 - 0.65), 2.3, z] });
    }
  }
  // Side-wall acoustic fins; openings left at both ends of the room.
  for (const side of [-1, 1]) {
    for (let z = -depth / 2 + 5; z < depth / 2 - 5; z += 1.1) {
      panels.push({ size: [0.22, height * 0.48, 0.13], at: [side * (width / 2 - 0.3), height * 0.56, z] });
    }
    trim.push({ size: [0.05, 0.06, depth - 4], at: [side * (width / 2 - 0.5), 0.18, 0] });
  }
  if (nightclub) {
    // Receding ceiling portals give the dance floor a clear rhythm.
    for (const z of [-8, -2, 4, 10]) {
      panels.push({ size: [width - 4, 0.24, 0.38], at: [0, height - 0.65, z] });
      trim.push({ size: [width - 5, 0.025, 0.055], at: [0, height - 0.79, z + 0.12] });
    }
    // Twin players and a mixer on the existing DJ console.
    for (const x of [-1.6, 0, 1.6]) {
      panels.push({ size: [1.1, 0.12, 0.85], at: [x, 1.89, -12.4] });
      trim.push({ size: [0.3, 0.02, 0.22], at: [x, 1.96, -12.6] });
    }
  }
  group.add(boxes(panels, nightclub ? 0x202532 : 0x352c26), boxes(trim, nightclub ? 0x416ab4 : 0xb08753, true));
  return group;
}

/** End-stage concert arena: radial roof, suite fascia and two sky bridges.
 * Inspired by big urban arenas rather than a scale replica of one building.
 */
export function arenaArchitecture(): THREE.Group {
  const group = new THREE.Group();
  group.userData.sceneryId = 'arena-architecture';
  const structure: Box[] = [], trim: Box[] = [], glass: Box[] = [];
  for (let i = 0; i < 48; i++) {
    const a = i * Math.PI * 2 / 48;
    structure.push({ size: [0.32, 0.5, 76], at: [Math.sin(a) * 44, 29.3, Math.cos(a) * 44], yaw: a });
  }
  // Concourse/suite ribbons curve with the same stage-centered bowl.
  for (const [radius, y] of [[50.5, 9.4], [74, 22.1]]) {
    const half = radius < 60 ? 83 : 88;
    for (let i = 0; i < 96; i++) {
      const a = THREE.MathUtils.degToRad(-half + (i + 0.5) * half * 2 / 96);
      const length = radius * THREE.MathUtils.degToRad(half * 2 / 96) * 1.01;
      const at: [number, number, number] = [Math.sin(a) * radius, y, -14 + Math.cos(a) * radius];
      structure.push({ size: [length, 1.2, 0.65], at, yaw: a });
      glass.push({ size: [length * 0.86, 0.8, 0.12], at: [at[0], y + 1.25, at[2]], yaw: a });
      trim.push({ size: [length, 0.055, 0.7], at: [at[0], y - 0.5, at[2]], yaw: a });
    }
  }
  for (const x of [-39, 39]) {
    structure.push({ size: [4, 0.8, 70], at: [x, 24.2, 5] });
    for (const side of [-1, 1]) {
      structure.push({ size: [0.12, 1.2, 70], at: [x + side * 1.9, 25.1, 5] });
      trim.push({ size: [0.08, 0.045, 70], at: [x + side * 1.9, 24.7, 5] });
    }
    for (const z of [-24, -6, 12, 30]) {
      structure.push({ size: [0.12, 4, 0.12], at: [x, 27.2, z] });
    }
  }
  group.add(boxes(structure, 0x20242c), boxes(glass, 0x111b27), boxes(trim, 0x334866, true));
  return group;
}
