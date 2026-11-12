import { describe, expect, it } from 'vitest';
import { MirrorMeshError, mirrorMeshCommand, parseMirrorMesh } from './mirrorMesh';

/** A small 16:9 mesh: x across -16/9..16/9, y -1..1, u/v straight across, the corners unused. */
function meshText({ columnsFirst = false, type = 2 } = {}): string {
  const nx = 4;
  const ny = 3;
  const aspect = 16 / 9;
  const node = (i: number, j: number) => {
    const x = -aspect + (2 * aspect * i) / (nx - 1);
    const y = -1 + (2 * j) / (ny - 1);
    const corner = (i === 0 || i === nx - 1) && j === 0;
    return `${x.toFixed(6)} ${y.toFixed(6)} ${(i / (nx - 1)).toFixed(6)} ${(j / (ny - 1)).toFixed(6)} ${corner ? -1 : 1}`;
  };
  const lines = [`${type}`, `${nx} ${ny}`];
  if (columnsFirst) {
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) lines.push(node(i, j));
  } else {
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) lines.push(node(i, j));
  }
  return lines.join('\n');
}

describe('mirror dome warp meshes', () => {
  it('reads a text mesh', () => {
    const mesh = parseMirrorMesh(meshText(), 'standard_16x9.data');
    expect(mesh).toMatchObject({ name: 'standard_16x9.data', type: 2, cols: 4, rows: 3 });
    expect(mesh.nodes).toHaveLength(4 * 3 * 5);
    expect(mesh.aspect).toBeCloseTo(16 / 9, 5);
    // 3 x 2 cells; the two bottom corner cells touch an unused node.
    expect(mesh.drawnCells).toBe(4);
  });

  it('turns a mesh listed column by column into rows', () => {
    const rows = parseMirrorMesh(meshText());
    const cols = parseMirrorMesh(meshText({ columnsFirst: true }));
    expect(cols.nodes).toEqual(rows.nodes);
    expect(cols.id).toBe(rows.id);
  });

  it('reads the binary form in either byte order', () => {
    const text = parseMirrorMesh(meshText());
    for (const little of [true, false]) {
      const buffer = new ArrayBuffer(6 + text.nodes.length * 4);
      const view = new DataView(buffer);
      view.setUint16(0, 2, little);
      view.setUint16(2, text.cols, little);
      view.setUint16(4, text.rows, little);
      text.nodes.forEach((value, k) => view.setFloat32(6 + k * 4, value, little));
      const binary = parseMirrorMesh(buffer, 'mesh.bin');
      expect(binary.cols).toBe(4);
      expect(binary.nodes[5]).toBeCloseTo(text.nodes[5], 5);
      expect(binary.drawnCells).toBe(4);
    }
  });

  it('says what is wrong with a file that is not a fisheye mesh', () => {
    expect(() => parseMirrorMesh('hello')).toThrow(MirrorMeshError);
    expect(() => parseMirrorMesh(meshText({ type: 4 }))).toThrow(/fisheye mesh/);
    expect(() => parseMirrorMesh('2\n4 3\n0 0 0 0 1')).toThrow(/points/);
  });

  it('hands the core the mesh by its content', () => {
    const mesh = parseMirrorMesh(meshText());
    const command = mirrorMeshCommand(mesh);
    expect(command).toMatchObject({ type: 'set_mirror_mesh', mesh_id: mesh.id, cols: 4, rows: 3 });
    expect(parseMirrorMesh(meshText(), 'other name').id).toBe(mesh.id);
  });
});
