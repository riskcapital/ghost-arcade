/**
 * Mirror dome warp meshes: Paul Bourke's mesh format, as written by his
 * meshmapper and handed out by dome makers for single-projector spherical
 * mirror domes.
 *
 * A mesh says, for a grid of points across the projector's image, which
 * point of the fisheye (domemaster) picture lands there and how bright:
 *
 *   ASCII             2                      mesh type (2 rectangular, 1 polar)
 *                     nx ny                  grid size
 *                     x y u v i   (nx*ny)    one node per line
 *
 *   x, y  the projector image, -aspect..aspect by -1..1, y up
 *   u, v  the fisheye picture, 0..1, v up; outside 0..1 the node is unused
 *   i     brightness 0..1; below 0 the node is not drawn
 *
 * The binary form is the same with the type and the two sizes as unsigned
 * 16-bit integers and each node as five 32-bit floats; the type's byte
 * order tells the file's.
 *
 * The render core draws the dome picture through the mesh as geometry
 * (render_mirror_mesh in main.rs), so the mesh carries the whole optics:
 * projector, mirror and dome.
 */

export interface MirrorMesh {
  /** File name it came from, for the inspector. */
  name: string;
  /** Content hash: the core caches the mesh by it. */
  id: string;
  /** 2 rectangular, 1 polar (its columns wrap round). */
  type: 1 | 2;
  /** Nodes across (x) and up (y). */
  cols: number;
  rows: number;
  /** x, y, u, v, intensity per node, x fastest then y. */
  nodes: number[];
  /** Widest |x|: the projector aspect the mesh was made for. */
  aspect: number;
  /** Grid cells that are drawn (all four corners in use). */
  drawnCells: number;
}

export class MirrorMeshError extends Error {}

const MAX_NODES = 512 * 512;

/** Read a mesh file: text or binary, whichever it is. */
export function parseMirrorMesh(data: ArrayBuffer | string, name = 'mesh'): MirrorMesh {
  if (typeof data !== 'string') {
    const bytes = new Uint8Array(data);
    if (looksBinary(bytes)) return fromNodes(name, ...readBinary(data));
    data = new TextDecoder().decode(bytes);
  }
  return fromNodes(name, ...readText(data));
}

function looksBinary(bytes: Uint8Array): boolean {
  const head = bytes.subarray(0, Math.min(bytes.length, 64));
  return head.some((b) => b === 0 || (b < 9 && b !== 0));
}

function readText(text: string): [number, number, number, number[]] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
  if (lines.length < 3) throw new MirrorMeshError('This is not a warp mesh: it has too few lines.');
  const type = Number(lines[0]);
  const dims = lines[1].split(/\s+/).map(Number);
  if (dims.length < 2) throw new MirrorMeshError('The second line should give the mesh size, as two numbers.');
  const [nx, ny] = dims;
  const nodes: number[] = [];
  for (let k = 2; k < lines.length && nodes.length < nx * ny * 5; k++) {
    const values = lines[k].split(/\s+/).map(Number);
    if (values.length < 5) throw new MirrorMeshError(`Line ${k + 1} should hold five numbers (x y u v intensity).`);
    nodes.push(values[0], values[1], values[2], values[3], values[4]);
  }
  return [type, nx, ny, nodes];
}

function readBinary(buffer: ArrayBuffer): [number, number, number, number[]] {
  if (buffer.byteLength < 6) throw new MirrorMeshError('This is not a warp mesh: the file is too short.');
  const view = new DataView(buffer);
  // The type is 1 or 2, so whichever byte order reads it as that is the file's.
  const little = view.getUint16(0, true) <= 5;
  const type = view.getUint16(0, little);
  const nx = view.getUint16(2, little);
  const ny = view.getUint16(4, little);
  const count = nx * ny;
  if (6 + count * 20 > buffer.byteLength) throw new MirrorMeshError(`The file is shorter than a ${nx} by ${ny} mesh.`);
  const nodes = new Array<number>(count * 5);
  for (let k = 0; k < count * 5; k++) nodes[k] = view.getFloat32(6 + k * 4, little);
  return [type, nx, ny, nodes];
}

function fromNodes(name: string, type: number, nx: number, ny: number, raw: number[]): MirrorMesh {
  if (type !== 1 && type !== 2) {
    throw new MirrorMeshError(
      type === 4 || type === 5
        ? 'This mesh is for spherical or cube-map pictures. A mirror dome needs a fisheye mesh (type 2).'
        : `Unknown mesh type ${type}. A mirror dome mesh starts with 2.`,
    );
  }
  if (!Number.isInteger(nx) || !Number.isInteger(ny) || nx < 2 || ny < 2) {
    throw new MirrorMeshError('The mesh size should be two whole numbers, each at least 2.');
  }
  if (nx * ny > MAX_NODES) throw new MirrorMeshError(`A ${nx} by ${ny} mesh is larger than this app reads (${MAX_NODES} points).`);
  if (raw.length < nx * ny * 5) throw new MirrorMeshError(`The file has ${raw.length / 5} points, not the ${nx * ny} a ${nx} by ${ny} mesh needs.`);
  if (raw.some((value) => !Number.isFinite(value))) throw new MirrorMeshError('The mesh has a point that is not a number.');

  // Rows of x first is the usual order; a file that lists columns first is
  // turned round so the core always gets x fastest.
  let cols = nx;
  let rows = ny;
  let nodes = raw.slice(0, nx * ny * 5);
  const dx = Math.abs(nodes[5] - nodes[0]);
  const dy = Math.abs(nodes[6] - nodes[1]);
  if (dy > dx) {
    const turned = new Array<number>(nodes.length);
    // Read as `nx` columns of `ny` points each: point (col c, row r) is at c * ny + r.
    for (let c = 0; c < nx; c++) {
      for (let r = 0; r < ny; r++) {
        for (let f = 0; f < 5; f++) turned[(r * nx + c) * 5 + f] = nodes[(c * ny + r) * 5 + f];
      }
    }
    nodes = turned;
  }

  let aspect = 0;
  for (let k = 0; k < cols * rows; k++) aspect = Math.max(aspect, Math.abs(nodes[k * 5]));
  return {
    name,
    id: hashNodes(type, cols, rows, nodes),
    type: type as 1 | 2,
    cols,
    rows,
    nodes,
    aspect: aspect || 1,
    drawnCells: countDrawnCells(cols, rows, nodes, type === 1),
  };
}

export function nodeInUse(nodes: number[], k: number): boolean {
  const u = nodes[k * 5 + 2];
  const v = nodes[k * 5 + 3];
  return nodes[k * 5 + 4] >= 0 && u >= 0 && u <= 1 && v >= 0 && v <= 1;
}

function countDrawnCells(cols: number, rows: number, nodes: number[], wrap: boolean): number {
  let drawn = 0;
  const across = wrap ? cols : cols - 1;
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < across; c++) {
      const c1 = (c + 1) % cols;
      if ([r * cols + c, r * cols + c1, (r + 1) * cols + c, (r + 1) * cols + c1].every((k) => nodeInUse(nodes, k))) drawn++;
    }
  }
  return drawn;
}

/** FNV-1a over the mesh, as text: stable across sessions and machines. */
function hashNodes(type: number, cols: number, rows: number, nodes: number[]): string {
  let h = 0x811c9dc5;
  const feed = (text: string) => {
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  };
  feed(`${type}:${cols}x${rows}:`);
  for (const value of nodes) feed(`${Math.round(value * 1e5)},`);
  return `mesh-${h.toString(16).padStart(8, '0')}`;
}

/** Native `set_mirror_mesh` payload. */
export function mirrorMeshCommand(mesh: MirrorMesh) {
  return {
    type: 'set_mirror_mesh' as const,
    mesh_id: mesh.id,
    mesh_type: mesh.type,
    cols: mesh.cols,
    rows: mesh.rows,
    nodes: mesh.nodes,
  };
}
