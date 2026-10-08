// Loads the PLY files written by the Swift scan tests with the DESKTOP's own PLY loader and checks
// that the desktop sees what the phone wrote: a plain point cloud, right count, bounds, colour,
// upright, centred, and evenly thinned when the desktop applies a point budget.
// Usage: node verify-scan-ply.mjs <folder with *.ply + expected.json> [path to desktop plyLoader.ts]
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const folder = resolve(process.argv[2] ?? '.');
const loaderPath = resolve(process.argv[3] ?? join(here, '../../src/lib/splat/plyLoader.ts'));
const loader = await import(pathToFileURL(loaderPath).href);
console.log(`desktop loader: ${loaderPath}`);

let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`); if (!ok) failures += 1; };
const close = (a, b, tolerance) => Math.abs(a - b) <= tolerance;
const n = (v) => v.toFixed(3);

// The framing every desktop point renderer applies (packSplatNativePoints, computeSplatNormalization):
// centre on the bounding box, scale the largest side to 4 units.
function framed(positions, count) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; i++) for (let a = 0; a < 3; a++) { const v = positions[i * 3 + a]; if (v < lo[a]) lo[a] = v; if (v > hi[a]) hi[a] = v; }
  const size = hi.map((v, a) => v - lo[a]);
  return { lo, hi, size, centre: lo.map((v, a) => (v + hi[a]) / 2), scale: 4 / Math.max(...size, 1e-6) };
}

for (const want of JSON.parse(readFileSync(join(folder, 'expected.json'), 'utf8'))) {
  const bytes = readFileSync(join(folder, want.file));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const tag = want.file;

  // Path 1: Point Cloud layer (loadPLY -> parsePLYBufferProgressive -> pointCloudBuffersFromPLYData).
  const data = await loader.parsePLYBufferProgressive(buffer, { maxPoints: loader.DEFAULT_SPLAT_POINT_BUDGET });
  check(`${tag}: read as a plain point cloud, nothing thinned`, data.dataType === 'pointcloud' && !data.wasDecimated && data.vertices.length === want.count && data.sourceVertexCount === want.count, `${data.vertices.length} points`);
  const box = data.boundingBox;
  const boundsOk = ['x', 'y', 'z'].every((axis, a) => close(box.min[axis], want.min[a], 1e-4) && close(box.max[axis], want.max[a], 1e-4));
  check(`${tag}: bounds match`, boundsOk, `${n(box.max.x - box.min.x)} x ${n(box.max.y - box.min.y)} x ${n(box.max.z - box.min.z)} m`);
  check(`${tag}: floor at y = 0, centred in x and z`, close(box.min.y, 0, 1e-5) && close(data.center.x, 0, 1e-4) && close(data.center.z, 0, 1e-4), `centre ${n(data.center.x)} ${n(data.center.y)} ${n(data.center.z)}`);
  const first = data.vertices[0];
  check(`${tag}: first point and colour exact`, close(first.x, want.first[0], 1e-6) && close(first.y, want.first[1], 1e-6) && close(first.z, want.first[2], 1e-6) && first.r === want.firstColor[0] && first.g === want.firstColor[1] && first.b === want.firstColor[2] && first.a === 255 && first.nx === undefined && first.scale_0 === undefined);
  const mean = [0, 0, 0];
  for (const v of data.vertices) { mean[0] += v.r; mean[1] += v.g; mean[2] += v.b; }
  check(`${tag}: mean colour matches`, mean.every((v, a) => close(v / data.vertices.length, want.meanColor[a], 0.01)), mean.map((v) => (v / data.vertices.length).toFixed(1)).join(' '));
  const packed = loader.pointCloudBuffersFromPLYData(data, { maxPoints: loader.DEFAULT_SPLAT_POINT_BUDGET });
  const full = framed(packed.positions, packed.sampleCount);
  check(`${tag}: native buffers complete, opaque, no gaussian data`, packed.sampleCount === want.count && !packed.gaussian && packed.splatScale === undefined && packed.alpha.every((v) => v === 1));

  // Path 2: Point Cloud FX fast path, at its 500k limit and at a tight budget.
  const fx = loader.parsePLYPointBuffers(buffer, { maxPoints: 500_000 });
  check(`${tag}: Point Cloud FX fast path agrees`, fx.dataType === 'pointcloud' && fx.sampleCount === Math.min(want.count, 500_000) && close(fx.boundingBox.min.y, 0, 1e-3));

  // Thinning: the desktop keeps every k-th point in file order. The thinned cloud must keep its frame.
  for (const budget of [50_000, 10_000]) {
    const thin = loader.parsePLYPointBuffers(buffer, { maxPoints: budget });
    const frame = framed(thin.positions, thin.sampleCount);
    const shift = Math.max(...frame.centre.map((v, a) => Math.abs(v - full.centre[a]))) * full.scale;
    const octants = new Array(8).fill(0);
    for (let i = 0; i < thin.sampleCount; i++) octants[(thin.positions[i * 3] > full.centre[0] ? 1 : 0) | (thin.positions[i * 3 + 1] > full.centre[1] ? 2 : 0) | (thin.positions[i * 3 + 2] > full.centre[2] ? 4 : 0)] += 1;
    const fullOctants = new Array(8).fill(0);
    for (let i = 0; i < packed.sampleCount; i++) fullOctants[(packed.positions[i * 3] > full.centre[0] ? 1 : 0) | (packed.positions[i * 3 + 1] > full.centre[1] ? 2 : 0) | (packed.positions[i * 3 + 2] > full.centre[2] ? 4 : 0)] += 1;
    const worst = Math.max(...octants.map((v, k) => Math.abs(v / thin.sampleCount - fullOctants[k] / packed.sampleCount)));
    check(`${tag}: thinned to ${budget} keeps the same frame and spread`, thin.sampleCount === Math.min(budget, want.count) && close(frame.scale / full.scale, 1, 0.02) && shift < 0.04 && worst < 0.012,
      `scale x${(frame.scale / full.scale).toFixed(4)}, centre moves ${shift.toFixed(4)} of 4 units, worst octant share off by ${(worst * 100).toFixed(2)}%`);
  }
  console.log(`${tag}: desktop frame = ${n(full.size[0])} x ${n(full.size[1])} x ${n(full.size[2])} m scaled x${full.scale.toFixed(3)} to 4 units`);
}
console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
