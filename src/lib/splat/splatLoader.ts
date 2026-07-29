// Native .splat format loader (Gaussian Splat binary format)
// The .splat format stores gaussian splats in a compact binary representation
// Each splat is 32 bytes:
//   - Position: 3x float32 (12 bytes)
//   - Scale: 3x float32 (12 bytes) — log-space scale values
//   - Color: RGBA as 4x uint8 (4 bytes)
//   - Rotation: quaternion as 4x uint8 (4 bytes) — normalized to [0,255] → [-1,1]

import { DEFAULT_SPLAT_POINT_BUDGET, type PLYVertex, type PLYData, type PLYLoadOptions } from './plyLoader';

const SPLAT_ROW_SIZE = 32;

/**
 * Parse a .splat binary buffer into PLYData-compatible format
 * so the existing SplatRenderer can use it directly
 */
function sampledSourceIndex(outputIndex: number, sourceCount: number, outputCount: number): number {
  if (outputCount >= sourceCount) return outputIndex;
  return Math.min(sourceCount - 1, Math.floor((outputIndex * sourceCount) / outputCount));
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function parseSplatBufferProgressive(buffer: ArrayBuffer, options: PLYLoadOptions = {}): Promise<PLYData> {
  const numSplats = Math.floor(buffer.byteLength / SPLAT_ROW_SIZE);
  if (numSplats === 0) {
    throw new Error('Invalid .splat file: no splat data found');
  }
  if (buffer.byteLength % SPLAT_ROW_SIZE !== 0) {
    throw new Error('Invalid .splat file: truncated row data');
  }

  console.log(`[splatLoader] Parsing ${numSplats} splats from ${buffer.byteLength} bytes`);

  const f32 = new Float32Array(buffer);
  const u8 = new Uint8Array(buffer);
  const outputCount = Math.min(numSplats, Math.max(1, Math.floor(options.maxPoints ?? DEFAULT_SPLAT_POINT_BUDGET)));
  const vertices: PLYVertex[] = new Array(outputCount);

  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  let sumX = 0,
    sumY = 0,
    sumZ = 0;

  for (let i = 0; i < outputCount; i++) {
    const sourceIndex = sampledSourceIndex(i, numSplats, outputCount);
    const f32Offset = (sourceIndex * SPLAT_ROW_SIZE) / 4; // float32 index
    const u8Offset = sourceIndex * SPLAT_ROW_SIZE; // byte index

    // Position: 3x float32 at bytes 0-11
    const x = f32[f32Offset];
    const y = f32[f32Offset + 1];
    const z = f32[f32Offset + 2];

    // Scale: 3x float32 at bytes 12-23
    const scale_0 = f32[f32Offset + 3];
    const scale_1 = f32[f32Offset + 4];
    const scale_2 = f32[f32Offset + 5];

    // Color: RGBA at bytes 24-27
    const r = u8[u8Offset + 24];
    const g = u8[u8Offset + 25];
    const b = u8[u8Offset + 26];
    const a = u8[u8Offset + 27];

    // Rotation: quaternion as uint8 at bytes 28-31, normalized from [0,255] to [-1,1]
    const rot_0 = (u8[u8Offset + 28] - 128) / 128;
    const rot_1 = (u8[u8Offset + 29] - 128) / 128;
    const rot_2 = (u8[u8Offset + 30] - 128) / 128;
    const rot_3 = (u8[u8Offset + 31] - 128) / 128;

    vertices[i] = {
      x,
      y,
      z,
      r,
      g,
      b,
      a,
      scale_0,
      scale_1,
      scale_2,
      rot_0,
      rot_1,
      rot_2,
      rot_3,
    };

    // Track bounds
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
    sumX += x;
    sumY += y;
    sumZ += z;

    if ((i + 1) % 25_000 === 0) {
      options.onProgress?.({
        phase: 'parse',
        progress: (i + 1) / outputCount,
        sourceVertexCount: numSplats,
        loadedVertexCount: i + 1,
      });
      await yieldToBrowser();
    }
  }

  options.onProgress?.({
    phase: 'parse',
    progress: 1,
    sourceVertexCount: numSplats,
    loadedVertexCount: outputCount,
  });

  return {
    vertices,
    sourceVertexCount: numSplats,
    wasDecimated: outputCount < numSplats,
    dataType: 'gaussian',
    scaleEncoding: 'linear',
    hasUVs: false,
    boundingBox: {
      min: { x: minX, y: minY, z: minZ },
      max: { x: maxX, y: maxY, z: maxZ },
    },
    center: {
      x: sumX / outputCount,
      y: sumY / outputCount,
      z: sumZ / outputCount,
    },
  };
}

export function parseSplatBuffer(buffer: ArrayBuffer): PLYData {
  const numSplats = Math.floor(buffer.byteLength / SPLAT_ROW_SIZE);
  if (numSplats === 0) {
    throw new Error('Invalid .splat file: no splat data found');
  }
  const f32 = new Float32Array(buffer);
  const u8 = new Uint8Array(buffer);
  const vertices: PLYVertex[] = new Array(numSplats);
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  let sumX = 0,
    sumY = 0,
    sumZ = 0;
  for (let i = 0; i < numSplats; i++) {
    const f32Offset = (i * SPLAT_ROW_SIZE) / 4;
    const u8Offset = i * SPLAT_ROW_SIZE;
    const x = f32[f32Offset];
    const y = f32[f32Offset + 1];
    const z = f32[f32Offset + 2];
    vertices[i] = {
      x,
      y,
      z,
      scale_0: f32[f32Offset + 3],
      scale_1: f32[f32Offset + 4],
      scale_2: f32[f32Offset + 5],
      r: u8[u8Offset + 24],
      g: u8[u8Offset + 25],
      b: u8[u8Offset + 26],
      a: u8[u8Offset + 27],
      rot_0: (u8[u8Offset + 28] - 128) / 128,
      rot_1: (u8[u8Offset + 29] - 128) / 128,
      rot_2: (u8[u8Offset + 30] - 128) / 128,
      rot_3: (u8[u8Offset + 31] - 128) / 128,
    };
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
    sumX += x;
    sumY += y;
    sumZ += z;
  }
  return {
    vertices,
    sourceVertexCount: numSplats,
    wasDecimated: false,
    dataType: 'gaussian',
    scaleEncoding: 'linear',
    hasUVs: false,
    boundingBox: {
      min: { x: minX, y: minY, z: minZ },
      max: { x: maxX, y: maxY, z: maxZ },
    },
    center: { x: sumX / numSplats, y: sumY / numSplats, z: sumZ / numSplats },
  };
}

/**
 * Load a .splat file from a File object
 */
export async function loadSplatFromFile(file: File): Promise<PLYData> {
  const buffer = await file.arrayBuffer();
  return parseSplatBufferProgressive(buffer);
}

export async function loadSplatFromFileProgressive(file: File, options: PLYLoadOptions = {}): Promise<PLYData> {
  options.onProgress?.({ phase: 'read', progress: 0 });
  const buffer = await file.arrayBuffer();
  options.onProgress?.({ phase: 'read', progress: 1 });
  return parseSplatBufferProgressive(buffer, options);
}

/**
 * Load a .splat file from a URL (blob URL or remote)
 */
export async function loadSplatFromUrl(url: string, options: PLYLoadOptions = {}): Promise<PLYData> {
  options.onProgress?.({ phase: 'read', progress: 0 });
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch .splat file: ${response.status} ${response.statusText}`);
  }
  const buffer = await response.arrayBuffer();
  options.onProgress?.({ phase: 'read', progress: 1 });
  return parseSplatBufferProgressive(buffer, options);
}
