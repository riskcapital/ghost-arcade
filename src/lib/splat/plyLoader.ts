// PLY File Loader for Point Clouds and Gaussian Splats
// Parses .ply files and detects whether they're point clouds or gaussian splats

import type { SplatDataType } from '../types';

export interface PLYVertex {
  x: number;
  y: number;
  z: number;
  r: number; // 0-255
  g: number;
  b: number;
  a: number; // opacity 0-255
  // Normal (optional)
  nx?: number;
  ny?: number;
  nz?: number;
  // Gaussian splat properties (optional)
  scale_0?: number;
  scale_1?: number;
  scale_2?: number;
  rot_0?: number; // Quaternion rotation
  rot_1?: number;
  rot_2?: number;
  rot_3?: number;
  // Spherical harmonics (optional, for advanced splats)
  f_dc_0?: number;
  f_dc_1?: number;
  f_dc_2?: number;
  // UV texture coordinates (optional, from file)
  texture_u?: number;
  texture_v?: number;
}

export interface PLYData {
  vertices: PLYVertex[];
  sourceVertexCount: number;
  wasDecimated: boolean;
  dataType: SplatDataType;
  scaleEncoding?: 'log' | 'linear';
  hasUVs: boolean;
  boundingBox: {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  };
  center: { x: number; y: number; z: number };
}

export interface PLYLoadProgress {
  phase: 'read' | 'parse';
  progress: number;
  sourceVertexCount?: number;
  loadedVertexCount?: number;
}

export interface PLYLoadOptions {
  maxPoints?: number;
  onProgress?: (status: PLYLoadProgress) => void;
}

export const DEFAULT_SPLAT_POINT_BUDGET = 1_500_000;

interface PLYProperty {
  name: string;
  type: string;
  isList: boolean;
  countType?: string;
}

interface PLYElement {
  name: string;
  count: number;
  properties: PLYProperty[];
}

const SH_C0 = 0.28209479177387814;

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function gaussianChannel(dc: number | undefined): number {
  return clampByte((0.5 + SH_C0 * (dc ?? 0)) * 255);
}

function gaussianOpacity(logit: number | undefined): number {
  if (logit === undefined) return 255;
  return clampByte((1 / (1 + Math.exp(-logit))) * 255);
}

function applyGaussianAppearance(
  vertex: PLYVertex,
  read: (name: string) => number | undefined,
  hasRgb: boolean,
  hasAlpha: boolean,
): void {
  const dc0 = read('f_dc_0');
  const dc1 = read('f_dc_1');
  const dc2 = read('f_dc_2');
  if (!hasRgb && (dc0 !== undefined || dc1 !== undefined || dc2 !== undefined)) {
    vertex.r = gaussianChannel(dc0);
    vertex.g = gaussianChannel(dc1);
    vertex.b = gaussianChannel(dc2);
  }
  if (!hasAlpha) {
    vertex.a = gaussianOpacity(read('opacity'));
  }
}

// Parse PLY header to extract element and property info
function parseHeader(text: string): {
  elements: PLYElement[];
  format: 'ascii' | 'binary_little_endian' | 'binary_big_endian';
  headerLength: number;
} {
  const lines = text.split('\n');
  const elements: PLYElement[] = [];
  let currentElement: PLYElement | null = null;
  let format: 'ascii' | 'binary_little_endian' | 'binary_big_endian' = 'ascii';
  let headerLength = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    headerLength += lines[i].length + 1; // +1 for newline

    if (line === 'end_header') {
      break;
    }

    if (line.startsWith('format ')) {
      const formatStr = line.split(' ')[1];
      if (formatStr === 'binary_little_endian') format = 'binary_little_endian';
      else if (formatStr === 'binary_big_endian') format = 'binary_big_endian';
      else format = 'ascii';
    }

    if (line.startsWith('element ')) {
      const parts = line.split(' ');
      currentElement = {
        name: parts[1],
        count: parseInt(parts[2], 10),
        properties: [],
      };
      elements.push(currentElement);
    }

    if (line.startsWith('property ') && currentElement) {
      const parts = line.split(' ');
      if (parts[1] === 'list') {
        currentElement.properties.push({
          name: parts[4],
          type: parts[3],
          isList: true,
          countType: parts[2],
        });
      } else {
        currentElement.properties.push({
          name: parts[2],
          type: parts[1],
          isList: false,
        });
      }
    }
  }

  return { elements, format, headerLength };
}

// Get byte size for a PLY type
function getTypeSize(type: string): number {
  switch (type) {
    case 'char':
    case 'uchar':
    case 'int8':
    case 'uint8':
      return 1;
    case 'short':
    case 'ushort':
    case 'int16':
    case 'uint16':
      return 2;
    case 'int':
    case 'uint':
    case 'int32':
    case 'uint32':
    case 'float':
    case 'float32':
      return 4;
    case 'double':
    case 'float64':
      return 8;
    default:
      return 4;
  }
}

// Read a value from a DataView based on type
function readValue(view: DataView, offset: number, type: string, littleEndian: boolean): number {
  switch (type) {
    case 'char':
    case 'int8':
      return view.getInt8(offset);
    case 'uchar':
    case 'uint8':
      return view.getUint8(offset);
    case 'short':
    case 'int16':
      return view.getInt16(offset, littleEndian);
    case 'ushort':
    case 'uint16':
      return view.getUint16(offset, littleEndian);
    case 'int':
    case 'int32':
      return view.getInt32(offset, littleEndian);
    case 'uint':
    case 'uint32':
      return view.getUint32(offset, littleEndian);
    case 'float':
    case 'float32':
      return view.getFloat32(offset, littleEndian);
    case 'double':
    case 'float64':
      return view.getFloat64(offset, littleEndian);
    default:
      return view.getFloat32(offset, littleEndian);
  }
}

// Detect if the PLY contains gaussian splat data
function isGaussianSplat(properties: PLYProperty[]): boolean {
  const propNames = properties.map((p) => p.name);
  // Gaussian splats typically have scale and rotation properties
  const hasScale = propNames.some((n) => n.startsWith('scale_'));
  const hasRotation = propNames.some((n) => n.startsWith('rot_'));
  return hasScale && hasRotation;
}

// Parse ASCII PLY data
function parseASCII(text: string, headerLength: number, elements: PLYElement[]): PLYVertex[] {
  const vertices: PLYVertex[] = [];
  const dataLines = text.substring(headerLength).trim().split('\n');

  const vertexElement = elements.find((e) => e.name === 'vertex');
  if (!vertexElement) return vertices;

  const propIndices: Record<string, number> = {};
  vertexElement.properties.forEach((p, i) => {
    propIndices[p.name] = i;
  });

  for (let i = 0; i < vertexElement.count && i < dataLines.length; i++) {
    const values = dataLines[i].trim().split(/\s+/).map(Number);
    const read = (name: string) => {
      const index = propIndices[name];
      return index === undefined ? undefined : values[index];
    };
    const hasRgb = propIndices.red !== undefined && propIndices.green !== undefined && propIndices.blue !== undefined;
    const hasAlpha = propIndices.alpha !== undefined;

    const vertex: PLYVertex = {
      x: read('x') ?? 0,
      y: read('y') ?? 0,
      z: read('z') ?? 0,
      r: read('red') ?? 255,
      g: read('green') ?? 255,
      b: read('blue') ?? 255,
      a: read('alpha') ?? 255,
    };

    // Normal
    if (propIndices.nx !== undefined) vertex.nx = values[propIndices.nx];
    if (propIndices.ny !== undefined) vertex.ny = values[propIndices.ny];
    if (propIndices.nz !== undefined) vertex.nz = values[propIndices.nz];

    // Gaussian splat properties
    if (propIndices.scale_0 !== undefined) vertex.scale_0 = values[propIndices.scale_0];
    if (propIndices.scale_1 !== undefined) vertex.scale_1 = values[propIndices.scale_1];
    if (propIndices.scale_2 !== undefined) vertex.scale_2 = values[propIndices.scale_2];
    if (propIndices.rot_0 !== undefined) vertex.rot_0 = values[propIndices.rot_0];
    if (propIndices.rot_1 !== undefined) vertex.rot_1 = values[propIndices.rot_1];
    if (propIndices.rot_2 !== undefined) vertex.rot_2 = values[propIndices.rot_2];
    if (propIndices.rot_3 !== undefined) vertex.rot_3 = values[propIndices.rot_3];

    // Spherical harmonics
    if (propIndices.f_dc_0 !== undefined) vertex.f_dc_0 = values[propIndices.f_dc_0];
    if (propIndices.f_dc_1 !== undefined) vertex.f_dc_1 = values[propIndices.f_dc_1];
    if (propIndices.f_dc_2 !== undefined) vertex.f_dc_2 = values[propIndices.f_dc_2];
    applyGaussianAppearance(vertex, read, hasRgb, hasAlpha);

    // UV coordinates (various naming conventions)
    const uIdx = propIndices.u ?? propIndices.s ?? propIndices.texture_u;
    const vIdx = propIndices.v ?? propIndices.t ?? propIndices.texture_v;
    if (uIdx !== undefined) vertex.texture_u = values[uIdx];
    if (vIdx !== undefined) vertex.texture_v = values[vIdx];

    vertices.push(vertex);
  }

  return vertices;
}

// Parse binary PLY data
function parseBinary(
  buffer: ArrayBuffer,
  headerLength: number,
  elements: PLYElement[],
  littleEndian: boolean,
  vertexDataOffset = 0,
): PLYVertex[] {
  const vertices: PLYVertex[] = [];
  const view = new DataView(buffer, headerLength);

  const vertexElement = elements.find((e) => e.name === 'vertex');
  if (!vertexElement) return vertices;

  // Calculate vertex stride
  let stride = 0;
  const propOffsets: Record<string, { offset: number; type: string }> = {};
  for (const prop of vertexElement.properties) {
    propOffsets[prop.name] = { offset: stride, type: prop.type };
    stride += getTypeSize(prop.type);
  }

  for (let i = 0; i < vertexElement.count; i++) {
    const baseOffset = vertexDataOffset + i * stride;

    const getValue = (name: string): number | undefined => {
      const info = propOffsets[name];
      if (!info) return undefined;
      return readValue(view, baseOffset + info.offset, info.type, littleEndian);
    };

    const hasRgb = !!(propOffsets.red && propOffsets.green && propOffsets.blue);
    const hasAlpha = !!propOffsets.alpha;
    const vertex: PLYVertex = {
      x: getValue('x') ?? 0,
      y: getValue('y') ?? 0,
      z: getValue('z') ?? 0,
      r: getValue('red') ?? 255,
      g: getValue('green') ?? 255,
      b: getValue('blue') ?? 255,
      a: getValue('alpha') ?? 255,
    };

    // Normalize color if stored as float
    const redInfo = propOffsets.red;
    if (redInfo && (redInfo.type === 'float' || redInfo.type === 'float32')) {
      vertex.r = Math.floor(vertex.r * 255);
      vertex.g = Math.floor(vertex.g * 255);
      vertex.b = Math.floor(vertex.b * 255);
    }
    const alphaInfo = propOffsets.alpha;
    if (alphaInfo && (alphaInfo.type === 'float' || alphaInfo.type === 'float32')) {
      vertex.a = Math.floor(vertex.a * 255);
    }

    // Normal
    const nx = getValue('nx');
    const ny = getValue('ny');
    const nz = getValue('nz');
    if (nx !== undefined) vertex.nx = nx;
    if (ny !== undefined) vertex.ny = ny;
    if (nz !== undefined) vertex.nz = nz;

    // Gaussian splat properties
    const scale_0 = getValue('scale_0');
    const scale_1 = getValue('scale_1');
    const scale_2 = getValue('scale_2');
    const rot_0 = getValue('rot_0');
    const rot_1 = getValue('rot_1');
    const rot_2 = getValue('rot_2');
    const rot_3 = getValue('rot_3');
    if (scale_0 !== undefined) vertex.scale_0 = scale_0;
    if (scale_1 !== undefined) vertex.scale_1 = scale_1;
    if (scale_2 !== undefined) vertex.scale_2 = scale_2;
    if (rot_0 !== undefined) vertex.rot_0 = rot_0;
    if (rot_1 !== undefined) vertex.rot_1 = rot_1;
    if (rot_2 !== undefined) vertex.rot_2 = rot_2;
    if (rot_3 !== undefined) vertex.rot_3 = rot_3;

    // Spherical harmonics
    const f_dc_0 = getValue('f_dc_0');
    const f_dc_1 = getValue('f_dc_1');
    const f_dc_2 = getValue('f_dc_2');
    if (f_dc_0 !== undefined) vertex.f_dc_0 = f_dc_0;
    if (f_dc_1 !== undefined) vertex.f_dc_1 = f_dc_1;
    if (f_dc_2 !== undefined) vertex.f_dc_2 = f_dc_2;
    applyGaussianAppearance(vertex, getValue, hasRgb, hasAlpha);

    // UV coordinates (various naming conventions)
    const tex_u = getValue('u') ?? getValue('s') ?? getValue('texture_u');
    const tex_v = getValue('v') ?? getValue('t') ?? getValue('texture_v');
    if (tex_u !== undefined) vertex.texture_u = tex_u;
    if (tex_v !== undefined) vertex.texture_v = tex_v;

    vertices.push(vertex);
  }

  return vertices;
}

function getVertexDataOffset(
  buffer: ArrayBuffer,
  headerLength: number,
  elements: PLYElement[],
  littleEndian: boolean,
): number {
  const view = new DataView(buffer, headerLength);
  let offset = 0;
  for (const element of elements) {
    if (element.name === 'vertex') return offset;
    offset = skipBinaryElement(view, offset, element, littleEndian);
  }
  return offset;
}

function sampledSourceIndex(outputIndex: number, sourceCount: number, outputCount: number): number {
  if (outputCount >= sourceCount) return outputIndex;
  if (outputCount <= 1) return 0;
  return Math.min(sourceCount - 1, Math.floor((outputIndex * sourceCount) / outputCount));
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function parseBinaryProgressive(
  buffer: ArrayBuffer,
  headerLength: number,
  elements: PLYElement[],
  littleEndian: boolean,
  maxPoints: number,
  onProgress?: PLYLoadOptions['onProgress'],
): Promise<PLYVertex[]> {
  const vertexElement = elements.find((e) => e.name === 'vertex');
  if (!vertexElement) return [];
  if (vertexElement.properties.some((property) => property.isList)) {
    throw new Error('PLY vertex list properties are not supported');
  }

  const view = new DataView(buffer, headerLength);
  const vertexDataOffset = getVertexDataOffset(buffer, headerLength, elements, littleEndian);
  let stride = 0;
  const propOffsets: Record<string, { offset: number; type: string }> = {};
  for (const prop of vertexElement.properties) {
    propOffsets[prop.name] = { offset: stride, type: prop.type };
    stride += getTypeSize(prop.type);
  }

  const outputCount = Math.min(vertexElement.count, maxPoints);
  const vertices = new Array<PLYVertex>(outputCount);
  const hasRgb = !!(propOffsets.red && propOffsets.green && propOffsets.blue);
  const hasAlpha = !!propOffsets.alpha;
  const redInfo = propOffsets.red;
  const alphaInfo = propOffsets.alpha;

  for (let outputIndex = 0; outputIndex < outputCount; outputIndex++) {
    const sourceIndex = sampledSourceIndex(outputIndex, vertexElement.count, outputCount);
    const baseOffset = vertexDataOffset + sourceIndex * stride;
    if (baseOffset + stride > view.byteLength) {
      throw new Error(
        `PLY vertex data ended early at ${sourceIndex.toLocaleString()} of ${vertexElement.count.toLocaleString()} points`,
      );
    }
    const read = (name: string): number | undefined => {
      const info = propOffsets[name];
      return info ? readValue(view, baseOffset + info.offset, info.type, littleEndian) : undefined;
    };
    const vertex: PLYVertex = {
      x: read('x') ?? 0,
      y: read('y') ?? 0,
      z: read('z') ?? 0,
      r: read('red') ?? 255,
      g: read('green') ?? 255,
      b: read('blue') ?? 255,
      a: read('alpha') ?? 255,
    };

    if (redInfo && (redInfo.type === 'float' || redInfo.type === 'float32')) {
      vertex.r = clampByte(vertex.r * 255);
      vertex.g = clampByte(vertex.g * 255);
      vertex.b = clampByte(vertex.b * 255);
    }
    if (alphaInfo && (alphaInfo.type === 'float' || alphaInfo.type === 'float32')) {
      vertex.a = clampByte(vertex.a * 255);
    }

    for (const name of [
      'nx',
      'ny',
      'nz',
      'scale_0',
      'scale_1',
      'scale_2',
      'rot_0',
      'rot_1',
      'rot_2',
      'rot_3',
      'f_dc_0',
      'f_dc_1',
      'f_dc_2',
    ] as const) {
      const value = read(name);
      if (value !== undefined) vertex[name] = value;
    }
    applyGaussianAppearance(vertex, read, hasRgb, hasAlpha);
    const textureU = read('u') ?? read('s') ?? read('texture_u');
    const textureV = read('v') ?? read('t') ?? read('texture_v');
    if (textureU !== undefined) vertex.texture_u = textureU;
    if (textureV !== undefined) vertex.texture_v = textureV;
    vertices[outputIndex] = vertex;

    if ((outputIndex + 1) % 25_000 === 0) {
      onProgress?.({
        phase: 'parse',
        progress: (outputIndex + 1) / outputCount,
        sourceVertexCount: vertexElement.count,
        loadedVertexCount: outputIndex + 1,
      });
      await yieldToBrowser();
    }
  }
  onProgress?.({
    phase: 'parse',
    progress: 1,
    sourceVertexCount: vertexElement.count,
    loadedVertexCount: outputCount,
  });
  return vertices;
}

async function parseASCIIProgressive(
  text: string,
  headerLength: number,
  elements: PLYElement[],
  maxPoints: number,
  onProgress?: PLYLoadOptions['onProgress'],
): Promise<PLYVertex[]> {
  const vertexElement = elements.find((e) => e.name === 'vertex');
  if (!vertexElement) return [];
  const outputCount = Math.min(vertexElement.count, maxPoints);
  const vertices = new Array<PLYVertex>(outputCount);
  const propIndices: Record<string, number> = {};
  vertexElement.properties.forEach((property, index) => {
    propIndices[property.name] = index;
  });
  const rowsBeforeVertex = elements
    .slice(0, elements.indexOf(vertexElement))
    .reduce((sum, element) => sum + element.count, 0);
  let cursor = headerLength;
  for (let row = 0; row < rowsBeforeVertex; row++) {
    const newline = text.indexOf('\n', cursor);
    cursor = newline < 0 ? text.length : newline + 1;
  }

  let sourceIndex = 0;
  let outputIndex = 0;
  let nextSample = sampledSourceIndex(outputIndex, vertexElement.count, outputCount);
  while (sourceIndex < vertexElement.count && cursor < text.length && outputIndex < outputCount) {
    const newline = text.indexOf('\n', cursor);
    const lineEnd = newline < 0 ? text.length : newline;
    if (sourceIndex === nextSample) {
      const values = text.slice(cursor, lineEnd).trim().split(/\s+/).map(Number);
      const read = (name: string): number | undefined => {
        const index = propIndices[name];
        return index === undefined ? undefined : values[index];
      };
      const hasRgb = propIndices.red !== undefined && propIndices.green !== undefined && propIndices.blue !== undefined;
      const hasAlpha = propIndices.alpha !== undefined;
      const vertex: PLYVertex = {
        x: read('x') ?? 0,
        y: read('y') ?? 0,
        z: read('z') ?? 0,
        r: read('red') ?? 255,
        g: read('green') ?? 255,
        b: read('blue') ?? 255,
        a: read('alpha') ?? 255,
      };
      for (const name of [
        'nx',
        'ny',
        'nz',
        'scale_0',
        'scale_1',
        'scale_2',
        'rot_0',
        'rot_1',
        'rot_2',
        'rot_3',
        'f_dc_0',
        'f_dc_1',
        'f_dc_2',
      ] as const) {
        const value = read(name);
        if (value !== undefined) vertex[name] = value;
      }
      applyGaussianAppearance(vertex, read, hasRgb, hasAlpha);
      const textureU = read('u') ?? read('s') ?? read('texture_u');
      const textureV = read('v') ?? read('t') ?? read('texture_v');
      if (textureU !== undefined) vertex.texture_u = textureU;
      if (textureV !== undefined) vertex.texture_v = textureV;
      vertices[outputIndex++] = vertex;
      nextSample = sampledSourceIndex(outputIndex, vertexElement.count, outputCount);
      if (outputIndex % 10_000 === 0) {
        onProgress?.({
          phase: 'parse',
          progress: outputIndex / outputCount,
          sourceVertexCount: vertexElement.count,
          loadedVertexCount: outputIndex,
        });
        await yieldToBrowser();
      }
    }
    sourceIndex++;
    cursor = newline < 0 ? text.length : newline + 1;
  }
  if (outputIndex !== outputCount) {
    throw new Error(
      `ASCII PLY ended after ${sourceIndex.toLocaleString()} of ${vertexElement.count.toLocaleString()} vertex rows`,
    );
  }
  onProgress?.({
    phase: 'parse',
    progress: 1,
    sourceVertexCount: vertexElement.count,
    loadedVertexCount: outputCount,
  });
  return vertices;
}

// Calculate bounding box and center
function calculateBounds(vertices: PLYVertex[]): {
  boundingBox: PLYData['boundingBox'];
  center: PLYData['center'];
} {
  if (vertices.length === 0) {
    return {
      boundingBox: {
        min: { x: 0, y: 0, z: 0 },
        max: { x: 0, y: 0, z: 0 },
      },
      center: { x: 0, y: 0, z: 0 },
    };
  }

  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;

  for (const v of vertices) {
    if (v.x < minX) minX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.z < minZ) minZ = v.z;
    if (v.x > maxX) maxX = v.x;
    if (v.y > maxY) maxY = v.y;
    if (v.z > maxZ) maxZ = v.z;
  }

  return {
    boundingBox: {
      min: { x: minX, y: minY, z: minZ },
      max: { x: maxX, y: maxY, z: maxZ },
    },
    center: {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
      z: (minZ + maxZ) / 2,
    },
  };
}

// Load PLY from file path or URL
export async function loadPLY(pathOrUrl: string, options: PLYLoadOptions = {}): Promise<PLYData> {
  let buffer: ArrayBuffer;

  const response = await fetch(pathOrUrl);
  if (!response.ok && !pathOrUrl.startsWith('blob:')) {
    throw new Error(`Failed to read PLY: ${response.status} ${response.statusText}`);
  }
  options.onProgress?.({ phase: 'read', progress: 0 });
  buffer = await response.arrayBuffer();
  options.onProgress?.({ phase: 'read', progress: 1 });

  await yieldToBrowser();
  return parsePLYBufferProgressive(buffer, options);
}

// Calculate the byte size of one element row (non-list properties only)
function getElementStride(element: PLYElement): number {
  let stride = 0;
  for (const prop of element.properties) {
    if (!prop.isList) {
      stride += getTypeSize(prop.type);
    }
  }
  return stride;
}

// Skip past a binary element that may contain list properties
// Returns the byte offset after skipping all rows of this element
function skipBinaryElement(view: DataView, startOffset: number, element: PLYElement, littleEndian: boolean): number {
  const hasList = element.properties.some((p) => p.isList);

  if (!hasList) {
    // Fixed-size rows — skip by stride × count
    const stride = getElementStride(element);
    return startOffset + stride * element.count;
  }

  // Variable-size rows — must walk each row
  let offset = startOffset;
  for (let i = 0; i < element.count; i++) {
    for (const prop of element.properties) {
      if (prop.isList) {
        const countSize = getTypeSize(prop.countType!);
        const count = readValue(view, offset, prop.countType!, littleEndian);
        offset += countSize;
        offset += count * getTypeSize(prop.type);
      } else {
        offset += getTypeSize(prop.type);
      }
    }
  }
  return offset;
}

// Read face vertex indices from a binary face element
// Returns array of faces, each face is an array of vertex indices
function readBinaryFaces(
  view: DataView,
  startOffset: number,
  faceElement: PLYElement,
  littleEndian: boolean,
): { faces: number[][]; endOffset: number } {
  const faces: number[][] = [];
  let offset = startOffset;

  for (let i = 0; i < faceElement.count; i++) {
    const face: number[] = [];
    for (const prop of faceElement.properties) {
      if (prop.isList) {
        const countSize = getTypeSize(prop.countType!);
        const count = readValue(view, offset, prop.countType!, littleEndian);
        offset += countSize;
        for (let j = 0; j < count; j++) {
          face.push(readValue(view, offset, prop.type, littleEndian));
          offset += getTypeSize(prop.type);
        }
      } else {
        offset += getTypeSize(prop.type);
      }
    }
    faces.push(face);
  }

  return { faces, endOffset: offset };
}

// Read multi_texture_vertex element (uchar tx, float u, float v)
function readBinaryMultiTextureVertices(
  view: DataView,
  startOffset: number,
  element: PLYElement,
  littleEndian: boolean,
): { uvs: { tx: number; u: number; v: number }[]; endOffset: number } {
  const uvs: { tx: number; u: number; v: number }[] = [];

  // Build property offsets
  let stride = 0;
  const propOffsets: Record<string, { offset: number; type: string }> = {};
  for (const prop of element.properties) {
    if (!prop.isList) {
      propOffsets[prop.name] = { offset: stride, type: prop.type };
      stride += getTypeSize(prop.type);
    }
  }

  for (let i = 0; i < element.count; i++) {
    const baseOffset = startOffset + i * stride;
    const txInfo = propOffsets['tx'];
    const uInfo = propOffsets['u'];
    const vInfo = propOffsets['v'];
    uvs.push({
      tx: txInfo ? readValue(view, baseOffset + txInfo.offset, txInfo.type, littleEndian) : 0,
      u: uInfo ? readValue(view, baseOffset + uInfo.offset, uInfo.type, littleEndian) : 0,
      v: vInfo ? readValue(view, baseOffset + vInfo.offset, vInfo.type, littleEndian) : 0,
    });
  }

  return { uvs, endOffset: startOffset + stride * element.count };
}

// Read multi_texture_face element to get texture vertex indices per face
// Format: uchar tx, uint tn, list uchar uint texture_vertex_indices
function readBinaryMultiTextureFaces(
  view: DataView,
  startOffset: number,
  element: PLYElement,
  littleEndian: boolean,
): { texFaces: number[][]; endOffset: number } {
  const texFaces: number[][] = [];
  let offset = startOffset;

  for (let i = 0; i < element.count; i++) {
    const texFace: number[] = [];
    for (const prop of element.properties) {
      if (prop.isList) {
        const countSize = getTypeSize(prop.countType!);
        const count = readValue(view, offset, prop.countType!, littleEndian);
        offset += countSize;
        for (let j = 0; j < count; j++) {
          texFace.push(readValue(view, offset, prop.type, littleEndian));
          offset += getTypeSize(prop.type);
        }
      } else {
        // Non-list properties (tx, tn) — just skip
        offset += getTypeSize(prop.type);
      }
    }
    texFaces.push(texFace);
  }

  return { texFaces, endOffset: offset };
}

// Parse PLY from ArrayBuffer (useful when file is already loaded)
export function parsePLYBuffer(buffer: ArrayBuffer): PLYData {
  // First, extract header as text
  const decoder = new TextDecoder('ascii');
  const headerText = decoder.decode(buffer.slice(0, Math.min(buffer.byteLength, 10000)));

  const { elements, format, headerLength } = parseHeader(headerText);

  const vertexElement = elements.find((e) => e.name === 'vertex');
  if (!vertexElement) {
    throw new Error('PLY file does not contain vertex element');
  }

  // Determine if this is a gaussian splat or point cloud
  const dataType: SplatDataType = isGaussianSplat(vertexElement.properties) ? 'gaussian' : 'pointcloud';

  let vertices: PLYVertex[];

  if (format === 'ascii') {
    // The former 10 KB header probe was also used as the entire ASCII file,
    // truncating every substantial ASCII PLY.
    const fullText = decoder.decode(buffer);
    vertices = parseASCII(fullText, headerLength, elements);
  } else {
    const littleEndian = format === 'binary_little_endian';
    const vertexDataOffset = getVertexDataOffset(buffer, headerLength, elements, littleEndian);
    vertices = parseBinary(buffer, headerLength, elements, littleEndian, vertexDataOffset);
  }

  // Check if vertices already have UVs (from vertex element properties)
  let hasUVs = vertices.length > 0 && vertices[0].texture_u !== undefined;

  // If no per-vertex UVs, try to read multi_texture elements (Artec 3D scanner format)
  if (!hasUVs && format !== 'ascii') {
    const faceElement = elements.find((e) => e.name === 'face');
    const multiTexVertElement = elements.find((e) => e.name === 'multi_texture_vertex');
    const multiTexFaceElement = elements.find((e) => e.name === 'multi_texture_face');

    if (faceElement && multiTexVertElement && multiTexFaceElement) {
      try {
        const littleEndian = format === 'binary_little_endian';
        const view = new DataView(buffer, headerLength);

        // Walk through binary data to find each element's offset
        // Elements appear in header order in the binary data
        let offset = 0;
        const elementOffsets: Record<string, number> = {};

        for (const el of elements) {
          elementOffsets[el.name] = offset;
          offset = skipBinaryElement(view, offset, el, littleEndian);
        }

        // Read face vertex indices
        const { faces } = readBinaryFaces(view, elementOffsets['face'], faceElement, littleEndian);

        // Read multi_texture_vertex UVs
        const { uvs: texVerts } = readBinaryMultiTextureVertices(
          view,
          elementOffsets['multi_texture_vertex'],
          multiTexVertElement,
          littleEndian,
        );

        // Read multi_texture_face texture vertex indices
        const { texFaces } = readBinaryMultiTextureFaces(
          view,
          elementOffsets['multi_texture_face'],
          multiTexFaceElement,
          littleEndian,
        );

        // Map UVs from texture vertices to geometry vertices via face connectivity
        // For each face, pair geometry vertex indices with texture vertex indices
        const numFaces = Math.min(faces.length, texFaces.length);
        for (let fi = 0; fi < numFaces; fi++) {
          const geomFace = faces[fi]; // geometry vertex indices
          const texFace = texFaces[fi]; // texture vertex indices

          const count = Math.min(geomFace.length, texFace.length);
          for (let ci = 0; ci < count; ci++) {
            const vertIdx = geomFace[ci];
            const texVertIdx = texFace[ci];

            // Only assign if vertex doesn't already have UVs (first-write wins)
            if (
              vertIdx < vertices.length &&
              texVertIdx < texVerts.length &&
              vertices[vertIdx].texture_u === undefined
            ) {
              vertices[vertIdx].texture_u = texVerts[texVertIdx].u;
              vertices[vertIdx].texture_v = texVerts[texVertIdx].v;
            }
          }
        }

        hasUVs = vertices.some((v) => v.texture_u !== undefined);
        if (hasUVs) {
          console.log(
            `[PLY] Mapped UVs from multi_texture elements to ${vertices.filter((v) => v.texture_u !== undefined).length}/${vertices.length} vertices`,
          );
        }
      } catch (err) {
        console.warn('[PLY] Failed to parse multi_texture elements:', err);
      }
    }
  }

  const { boundingBox, center } = calculateBounds(vertices);

  return {
    vertices,
    sourceVertexCount: vertexElement.count,
    wasDecimated: false,
    dataType,
    scaleEncoding: dataType === 'gaussian' ? 'log' : undefined,
    hasUVs,
    boundingBox,
    center,
  };
}

export async function parsePLYBufferProgressive(buffer: ArrayBuffer, options: PLYLoadOptions = {}): Promise<PLYData> {
  if (buffer.byteLength < 16) throw new Error('PLY file is empty or incomplete');
  const decoder = new TextDecoder('ascii');
  const headerProbe = decoder.decode(buffer.slice(0, Math.min(buffer.byteLength, 64 * 1024)));
  if (!headerProbe.includes('end_header')) {
    throw new Error('PLY header is incomplete or exceeds the supported 64 KB header limit');
  }
  const { elements, format, headerLength } = parseHeader(headerProbe);
  const vertexElement = elements.find((element) => element.name === 'vertex');
  if (!vertexElement) throw new Error('PLY file does not contain vertex element');
  if (headerLength >= buffer.byteLength) throw new Error('PLY file contains a header but no vertex data');

  const maxPoints = Math.max(1, Math.floor(options.maxPoints ?? DEFAULT_SPLAT_POINT_BUDGET));
  const dataType: SplatDataType = isGaussianSplat(vertexElement.properties) ? 'gaussian' : 'pointcloud';
  let vertices: PLYVertex[];
  if (format === 'ascii') {
    const fullText = decoder.decode(buffer);
    vertices = await parseASCIIProgressive(fullText, headerLength, elements, maxPoints, options.onProgress);
  } else {
    vertices = await parseBinaryProgressive(
      buffer,
      headerLength,
      elements,
      format === 'binary_little_endian',
      maxPoints,
      options.onProgress,
    );
  }

  const hasUVs = vertices.length > 0 && vertices.some((vertex) => vertex.texture_u !== undefined);
  const { boundingBox, center } = calculateBounds(vertices);
  return {
    vertices,
    sourceVertexCount: vertexElement.count,
    wasDecimated: vertices.length < vertexElement.count,
    dataType,
    scaleEncoding: dataType === 'gaussian' ? 'log' : undefined,
    hasUVs,
    boundingBox,
    center,
  };
}

// Load PLY from File object (for drag-and-drop or file input)
export async function loadPLYFromFile(file: File, options: PLYLoadOptions = {}): Promise<PLYData> {
  options.onProgress?.({ phase: 'read', progress: 0 });
  const buffer = await file.arrayBuffer();
  options.onProgress?.({ phase: 'read', progress: 1 });
  await yieldToBrowser();
  return parsePLYBufferProgressive(buffer, options);
}
