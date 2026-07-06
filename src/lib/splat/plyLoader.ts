// PLY File Loader for Point Clouds and Gaussian Splats
// Parses .ply files and detects whether they're point clouds or gaussian splats

import type { SplatDataType } from '../types';

export interface PLYVertex {
  x: number;
  y: number;
  z: number;
  r: number;  // 0-255
  g: number;
  b: number;
  a: number;  // opacity 0-255
  // Normal (optional)
  nx?: number;
  ny?: number;
  nz?: number;
  // Gaussian splat properties (optional)
  scale_0?: number;
  scale_1?: number;
  scale_2?: number;
  rot_0?: number;  // Quaternion rotation
  rot_1?: number;
  rot_2?: number;
  rot_3?: number;
  // Spherical harmonics (optional, for advanced splats)
  f_dc_0?: number;
  f_dc_1?: number;
  f_dc_2?: number;
  f_rest?: number[];
  // UV texture coordinates (optional, from file)
  texture_u?: number;
  texture_v?: number;
}

export interface PLYData {
  vertices: PLYVertex[];
  faces?: number[][];
  dataType: SplatDataType;
  hasUVs: boolean;
  sphericalHarmonicsDegree?: number;
  sphericalHarmonicsCoefficientCount?: number;
  boundingBox: {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  };
  center: { x: number; y: number; z: number };
}

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

interface ParsedPropertyValue {
  name: string;
  value: number;
  type: string;
}

const SH_C0 = 0.28209479177387814;
const END_HEADER_BYTES = new Uint8Array([101, 110, 100, 95, 104, 101, 97, 100, 101, 114]);
const PLY_HEADER_DECODER = new TextDecoder('ascii');

const RED_PROPERTY_NAMES = [
  'red', 'r', 'diffuse_red', 'diffuse_r', 'base_color_red', 'base_color_r', 'color_red', 'scalar_red', 'scalar_Red'
];
const GREEN_PROPERTY_NAMES = [
  'green', 'g', 'diffuse_green', 'diffuse_g', 'base_color_green', 'base_color_g', 'color_green', 'scalar_green', 'scalar_Green'
];
const BLUE_PROPERTY_NAMES = [
  'blue', 'b', 'diffuse_blue', 'diffuse_b', 'base_color_blue', 'base_color_b', 'color_blue', 'scalar_blue', 'scalar_Blue'
];
const ALPHA_PROPERTY_NAMES = [
  'alpha', 'a', 'opacity', 'diffuse_alpha', 'base_color_alpha', 'color_alpha'
];

function normalizePLYType(type: string): string {
  switch (type.toLowerCase()) {
    case 'int8_t': return 'int8';
    case 'uint8_t': return 'uint8';
    case 'int16_t': return 'int16';
    case 'uint16_t': return 'uint16';
    case 'int32_t': return 'int32';
    case 'uint32_t': return 'uint32';
    case 'float32_t': return 'float32';
    case 'float64_t': return 'float64';
    default: return type.toLowerCase();
  }
}

function isFloatType(type: string): boolean {
  const normalized = normalizePLYType(type);
  return normalized === 'float' || normalized === 'float32' || normalized === 'double' || normalized === 'float64';
}

function clampByte(value: number): number {
  if (!Number.isFinite(value)) return 255;
  return Math.max(0, Math.min(255, Math.round(value)));
}

function sigmoid(value: number): number {
  if (value >= 0) {
    const z = Math.exp(-value);
    return 1 / (1 + z);
  }
  const z = Math.exp(value);
  return z / (1 + z);
}

function gaussianDcToByte(value: number): number {
  return clampByte((0.5 + SH_C0 * value) * 255);
}

function normalizeColorValue(value: number, type: string): number {
  if (isFloatType(type) && value >= 0 && value <= 1) return clampByte(value * 255);
  return clampByte(value);
}

function normalizeAlphaValue(value: number, type: string, propertyName: string, gaussian: boolean): number {
  if (propertyName === 'opacity' && gaussian) {
    return clampByte(sigmoid(value) * 255);
  }
  if (isFloatType(type) && value >= 0 && value <= 1) return clampByte(value * 255);
  return clampByte(value);
}

function getIndexedProperty(
  values: number[],
  propIndices: Record<string, number>,
  properties: PLYProperty[],
  names: string[]
): ParsedPropertyValue | undefined {
  for (const name of names) {
    const index = propIndices[name];
    if (index === undefined) continue;
    const value = values[index];
    if (!Number.isFinite(value)) continue;
    return { name, value, type: properties[index]?.type ?? 'float' };
  }
  return undefined;
}

function getBinaryProperty(
  propOffsets: Record<string, { offset: number; type: string }>,
  getValue: (name: string) => number | undefined,
  names: string[]
): ParsedPropertyValue | undefined {
  for (const name of names) {
    const info = propOffsets[name];
    if (!info) continue;
    const value = getValue(name);
    if (value === undefined || !Number.isFinite(value)) continue;
    return { name, value, type: info.type };
  }
  return undefined;
}

function sphericalHarmonicsRestPropertyNames(properties: PLYProperty[]): string[] {
  return properties
    .map((property) => {
      const match = /^f_rest_(\d+)$/.exec(property.name);
      return match ? { name: property.name, index: Number(match[1]) } : null;
    })
    .filter((entry): entry is { name: string; index: number } => !!entry && Number.isFinite(entry.index))
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.name);
}

function sphericalHarmonicsDegreeForRestCount(restCoefficientCount: number): number {
  if (restCoefficientCount <= 0 || restCoefficientCount % 3 !== 0) return 0;
  const basisCount = restCoefficientCount / 3 + 1;
  const degree = Math.sqrt(basisCount) - 1;
  const rounded = Math.round(degree);
  return Math.abs(degree - rounded) < 1e-4 ? rounded : 0;
}

function makeColorChannels(
  red: ParsedPropertyValue | undefined,
  green: ParsedPropertyValue | undefined,
  blue: ParsedPropertyValue | undefined,
  fDc0: ParsedPropertyValue | undefined,
  fDc1: ParsedPropertyValue | undefined,
  fDc2: ParsedPropertyValue | undefined
): { r: number; g: number; b: number } {
  return {
    r: red ? normalizeColorValue(red.value, red.type) : (fDc0 ? gaussianDcToByte(fDc0.value) : 255),
    g: green ? normalizeColorValue(green.value, green.type) : (fDc1 ? gaussianDcToByte(fDc1.value) : 255),
    b: blue ? normalizeColorValue(blue.value, blue.type) : (fDc2 ? gaussianDcToByte(fDc2.value) : 255),
  };
}

function extractPLYHeader(buffer: ArrayBuffer): { text: string; headerLength: number } {
  const bytes = new Uint8Array(buffer);
  let markerIndex = -1;

  for (let i = 0; i <= bytes.length - END_HEADER_BYTES.length; i++) {
    let matches = true;
    for (let j = 0; j < END_HEADER_BYTES.length; j++) {
      if (bytes[i + j] !== END_HEADER_BYTES[j]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      const before = i > 0 ? bytes[i - 1] : 10;
      const after = bytes[i + END_HEADER_BYTES.length] ?? 10;
      const lineStart = before === 10 || before === 13;
      const lineEnd = after === 10 || after === 13;
      if (!lineStart || !lineEnd) continue;
      markerIndex = i;
      break;
    }
  }

  if (markerIndex < 0) {
    throw new Error('PLY file is missing end_header');
  }

  let headerLength = markerIndex + END_HEADER_BYTES.length;
  if (bytes[headerLength] === 13 && bytes[headerLength + 1] === 10) {
    headerLength += 2;
  } else if (bytes[headerLength] === 10 || bytes[headerLength] === 13) {
    headerLength += 1;
  }

  return {
    text: PLY_HEADER_DECODER.decode(buffer.slice(0, headerLength)),
    headerLength,
  };
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
  switch (normalizePLYType(type)) {
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
  switch (normalizePLYType(type)) {
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
  const propNames = properties.map(p => p.name);
  // Gaussian splats typically have scale and rotation properties
  const hasScale = propNames.some(n => n.startsWith('scale_'));
  const hasRotation = propNames.some(n => n.startsWith('rot_'));
  return hasScale && hasRotation;
}

// Parse ASCII PLY data
function parseASCII(
  text: string,
  headerLength: number,
  elements: PLYElement[]
): PLYVertex[] {
  const vertices: PLYVertex[] = [];
  const dataLines = text.substring(headerLength).trim().split('\n');

  const vertexElement = elements.find(e => e.name === 'vertex');
  if (!vertexElement) return vertices;

  const propIndices: Record<string, number> = {};
  vertexElement.properties.forEach((p, i) => {
    propIndices[p.name] = i;
  });
  const gaussian = isGaussianSplat(vertexElement.properties);
  const shRestPropertyNames = sphericalHarmonicsRestPropertyNames(vertexElement.properties);

  for (let i = 0; i < vertexElement.count && i < dataLines.length; i++) {
    const values = dataLines[i].trim().split(/\s+/).map(Number);
    const fDc0 = getIndexedProperty(values, propIndices, vertexElement.properties, ['f_dc_0']);
    const fDc1 = getIndexedProperty(values, propIndices, vertexElement.properties, ['f_dc_1']);
    const fDc2 = getIndexedProperty(values, propIndices, vertexElement.properties, ['f_dc_2']);
    const color = makeColorChannels(
      getIndexedProperty(values, propIndices, vertexElement.properties, RED_PROPERTY_NAMES),
      getIndexedProperty(values, propIndices, vertexElement.properties, GREEN_PROPERTY_NAMES),
      getIndexedProperty(values, propIndices, vertexElement.properties, BLUE_PROPERTY_NAMES),
      fDc0,
      fDc1,
      fDc2
    );
    const alpha = getIndexedProperty(values, propIndices, vertexElement.properties, ALPHA_PROPERTY_NAMES);

    const vertex: PLYVertex = {
      x: values[propIndices.x] ?? 0,
      y: values[propIndices.y] ?? 0,
      z: values[propIndices.z] ?? 0,
      r: color.r,
      g: color.g,
      b: color.b,
      a: alpha ? normalizeAlphaValue(alpha.value, alpha.type, alpha.name, gaussian) : 255,
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
    if (fDc0) vertex.f_dc_0 = fDc0.value;
    if (fDc1) vertex.f_dc_1 = fDc1.value;
    if (fDc2) vertex.f_dc_2 = fDc2.value;
    if (shRestPropertyNames.length > 0) {
      vertex.f_rest = shRestPropertyNames.map((name) => {
        const value = values[propIndices[name]];
        return Number.isFinite(value) ? value : 0;
      });
    }

    // UV coordinates (various naming conventions)
    const uIdx = propIndices.u ?? propIndices.s ?? propIndices.texture_u;
    const vIdx = propIndices.v ?? propIndices.t ?? propIndices.texture_v;
    if (uIdx !== undefined) vertex.texture_u = values[uIdx];
    if (vIdx !== undefined) vertex.texture_v = values[vIdx];

    vertices.push(vertex);
  }

  return vertices;
}

function parseASCIIFaces(
  text: string,
  headerLength: number,
  elements: PLYElement[]
): number[][] {
  const faceElement = elements.find(e => e.name === 'face');
  if (!faceElement) return [];

  const dataLines = text.substring(headerLength).trim().split('\n');
  let lineIndex = 0;
  for (const element of elements) {
    if (element.name === 'face') break;
    lineIndex += element.count;
  }

  const faces: number[][] = [];
  for (let i = 0; i < faceElement.count && lineIndex + i < dataLines.length; i++) {
    const values = dataLines[lineIndex + i].trim().split(/\s+/).map(Number);
    let cursor = 0;
    let face: number[] = [];

    for (const prop of faceElement.properties) {
      if (prop.isList) {
        const count = values[cursor++] ?? 0;
        const indices = values.slice(cursor, cursor + count).map((value) => Math.trunc(value));
        cursor += count;
        if (prop.name === 'vertex_indices' || prop.name === 'vertex_index' || face.length === 0) {
          face = indices;
        }
      } else {
        cursor += 1;
      }
    }

    if (face.length >= 3) faces.push(face);
  }

  return faces;
}

// Parse binary PLY data
function parseBinary(
  buffer: ArrayBuffer,
  headerLength: number,
  elements: PLYElement[],
  littleEndian: boolean
): PLYVertex[] {
  const vertices: PLYVertex[] = [];
  const view = new DataView(buffer, headerLength);

  const vertexElement = elements.find(e => e.name === 'vertex');
  if (!vertexElement) return vertices;

  // Calculate vertex stride
  let stride = 0;
  const propOffsets: Record<string, { offset: number; type: string }> = {};
  for (const prop of vertexElement.properties) {
    propOffsets[prop.name] = { offset: stride, type: prop.type };
    stride += getTypeSize(prop.type);
  }
  const gaussian = isGaussianSplat(vertexElement.properties);
  const shRestPropertyNames = sphericalHarmonicsRestPropertyNames(vertexElement.properties);

  for (let i = 0; i < vertexElement.count; i++) {
    const baseOffset = i * stride;

    const getValue = (name: string): number | undefined => {
      const info = propOffsets[name];
      if (!info) return undefined;
      return readValue(view, baseOffset + info.offset, info.type, littleEndian);
    };

    const fDc0 = getBinaryProperty(propOffsets, getValue, ['f_dc_0']);
    const fDc1 = getBinaryProperty(propOffsets, getValue, ['f_dc_1']);
    const fDc2 = getBinaryProperty(propOffsets, getValue, ['f_dc_2']);
    const color = makeColorChannels(
      getBinaryProperty(propOffsets, getValue, RED_PROPERTY_NAMES),
      getBinaryProperty(propOffsets, getValue, GREEN_PROPERTY_NAMES),
      getBinaryProperty(propOffsets, getValue, BLUE_PROPERTY_NAMES),
      fDc0,
      fDc1,
      fDc2
    );
    const alpha = getBinaryProperty(propOffsets, getValue, ALPHA_PROPERTY_NAMES);

    const vertex: PLYVertex = {
      x: getValue('x') ?? 0,
      y: getValue('y') ?? 0,
      z: getValue('z') ?? 0,
      r: color.r,
      g: color.g,
      b: color.b,
      a: alpha ? normalizeAlphaValue(alpha.value, alpha.type, alpha.name, gaussian) : 255,
    };

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
    if (fDc0) vertex.f_dc_0 = fDc0.value;
    if (fDc1) vertex.f_dc_1 = fDc1.value;
    if (fDc2) vertex.f_dc_2 = fDc2.value;
    if (shRestPropertyNames.length > 0) {
      vertex.f_rest = shRestPropertyNames.map((name) => {
        const value = getValue(name);
        return Number.isFinite(value) ? value! : 0;
      });
    }

    // UV coordinates (various naming conventions)
    const tex_u = getValue('u') ?? getValue('s') ?? getValue('texture_u');
    const tex_v = getValue('v') ?? getValue('t') ?? getValue('texture_v');
    if (tex_u !== undefined) vertex.texture_u = tex_u;
    if (tex_v !== undefined) vertex.texture_v = tex_v;

    vertices.push(vertex);
  }

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

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

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
export async function loadPLY(pathOrUrl: string): Promise<PLYData> {
  let buffer: ArrayBuffer;

  // Handle Tauri file paths vs URLs
  if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) {
    const response = await fetch(pathOrUrl);
    buffer = await response.arrayBuffer();
  } else {
    // For local files in Tauri, we need to use the Tauri fs API
    // This will be called from the frontend which handles the file reading
    const response = await fetch(pathOrUrl);
    buffer = await response.arrayBuffer();
  }

  return parsePLYBuffer(buffer);
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
function skipBinaryElement(
  view: DataView,
  startOffset: number,
  element: PLYElement,
  littleEndian: boolean
): number {
  const hasList = element.properties.some(p => p.isList);

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
  littleEndian: boolean
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
  littleEndian: boolean
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
  littleEndian: boolean
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
  const { text: headerText, headerLength } = extractPLYHeader(buffer);
  const decoder = new TextDecoder('ascii');

  const { elements, format } = parseHeader(headerText);

  const vertexElement = elements.find(e => e.name === 'vertex');
  if (!vertexElement) {
    throw new Error('PLY file does not contain vertex element');
  }

  // Determine if this is a gaussian splat or point cloud
  const dataType: SplatDataType = isGaussianSplat(vertexElement.properties)
    ? 'gaussian'
    : 'pointcloud';
  const shRestCoefficientCount = sphericalHarmonicsRestPropertyNames(vertexElement.properties).length;
  const shDegree = sphericalHarmonicsDegreeForRestCount(shRestCoefficientCount);

  let vertices: PLYVertex[];
  let faces: number[][] = [];

  if (format === 'ascii') {
    const fullText = decoder.decode(buffer);
    vertices = parseASCII(fullText, headerLength, elements);
    faces = parseASCIIFaces(fullText, headerLength, elements);
  } else {
    const littleEndian = format === 'binary_little_endian';
    vertices = parseBinary(buffer, headerLength, elements, littleEndian);

    const faceElement = elements.find(e => e.name === 'face');
    if (faceElement) {
      const view = new DataView(buffer, headerLength);
      let offset = 0;
      let faceOffset = -1;
      for (const el of elements) {
        if (el.name === 'face') {
          faceOffset = offset;
          break;
        }
        offset = skipBinaryElement(view, offset, el, littleEndian);
      }
      if (faceOffset >= 0) {
        faces = readBinaryFaces(view, faceOffset, faceElement, littleEndian).faces.filter(face => face.length >= 3);
      }
    }
  }

  // Check if vertices already have UVs (from vertex element properties)
  let hasUVs = vertices.length > 0 && vertices[0].texture_u !== undefined;

  // If no per-vertex UVs, try to read multi_texture elements (Artec 3D scanner format)
  if (!hasUVs && format !== 'ascii') {
    const faceElement = elements.find(e => e.name === 'face');
    const multiTexVertElement = elements.find(e => e.name === 'multi_texture_vertex');
    const multiTexFaceElement = elements.find(e => e.name === 'multi_texture_face');

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
        const { faces } = readBinaryFaces(
          view, elementOffsets['face'], faceElement, littleEndian
        );

        // Read multi_texture_vertex UVs
        const { uvs: texVerts } = readBinaryMultiTextureVertices(
          view, elementOffsets['multi_texture_vertex'], multiTexVertElement, littleEndian
        );

        // Read multi_texture_face texture vertex indices
        const { texFaces } = readBinaryMultiTextureFaces(
          view, elementOffsets['multi_texture_face'], multiTexFaceElement, littleEndian
        );

        // Map UVs from texture vertices to geometry vertices via face connectivity
        // For each face, pair geometry vertex indices with texture vertex indices
        const numFaces = Math.min(faces.length, texFaces.length);
        for (let fi = 0; fi < numFaces; fi++) {
          const geomFace = faces[fi];     // geometry vertex indices
          const texFace = texFaces[fi];   // texture vertex indices

          const count = Math.min(geomFace.length, texFace.length);
          for (let ci = 0; ci < count; ci++) {
            const vertIdx = geomFace[ci];
            const texVertIdx = texFace[ci];

            // Only assign if vertex doesn't already have UVs (first-write wins)
            if (vertIdx < vertices.length &&
                texVertIdx < texVerts.length &&
                vertices[vertIdx].texture_u === undefined) {
              vertices[vertIdx].texture_u = texVerts[texVertIdx].u;
              vertices[vertIdx].texture_v = texVerts[texVertIdx].v;
            }
          }
        }

        hasUVs = vertices.some(v => v.texture_u !== undefined);
        if (hasUVs) {
          console.log(`[PLY] Mapped UVs from multi_texture elements to ${vertices.filter(v => v.texture_u !== undefined).length}/${vertices.length} vertices`);
        }
      } catch (err) {
        console.warn('[PLY] Failed to parse multi_texture elements:', err);
      }
    }
  }

  const { boundingBox, center } = calculateBounds(vertices);

  return {
    vertices,
    faces,
    dataType,
    hasUVs,
    sphericalHarmonicsDegree: shDegree,
    sphericalHarmonicsCoefficientCount: shRestCoefficientCount,
    boundingBox,
    center,
  };
}

// Load PLY from File object (for drag-and-drop or file input)
export async function loadPLYFromFile(file: File): Promise<PLYData> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const result = parsePLYBuffer(reader.result as ArrayBuffer);
        resolve(result);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}
