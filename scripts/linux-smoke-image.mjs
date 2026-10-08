// Image helpers for scripts/linux-smoke.mjs. No dependencies: the smoke run
// must judge pictures by their pixel values on a bare CI runner.
import zlib from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}

/** Encode tightly packed RGBA8 as a PNG. */
export function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 6; header[10] = 0; header[11] = 0; header[12] = 0;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Decode an 8-bit RGB or RGBA non-interlaced PNG (what CDP screenshots are)
 *  into tightly packed RGBA8. */
export function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let offset = 8;
  let width = 0, height = 0, colorType = 0, bitDepth = 0, interlace = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`unsupported PNG (depth ${bitDepth}, colour type ${colorType}, interlace ${interlace})`);
  }
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const rows = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = rows.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? rows.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let value = line[x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[x] = value & 0xff;
    }
  }
  if (bpp === 4) return { width, height, rgba: new Uint8Array(rows.buffer, rows.byteOffset, rows.length) };
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0, j = 0; i < rows.length; i += 3, j += 4) {
    rgba[j] = rows[i]; rgba[j + 1] = rows[i + 1]; rgba[j + 2] = rows[i + 2]; rgba[j + 3] = 255;
  }
  return { width, height, rgba };
}

/** A core snapshot (`*_snapshot` RPC with include_pixels) as an RGBA image.
 *  The core delivers rows tightly packed whatever padded_bytes_per_row says. */
export function snapshotImage(snapshot) {
  if (!snapshot?.rgba_b64) throw new Error(`snapshot has no pixels (keys: ${Object.keys(snapshot || {}).join(',')})`);
  const bytes = Buffer.from(snapshot.rgba_b64, 'base64');
  const { width, height } = snapshot;
  const stride = bytes.length >= Number(snapshot.padded_bytes_per_row || 0) * height && snapshot.padded_bytes_per_row
    ? Number(snapshot.padded_bytes_per_row) : width * 4;
  const bgra = String(snapshot.storage_format || snapshot.format || '').toLowerCase().startsWith('bgra');
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = y * stride + x * 4, d = (y * width + x) * 4;
      rgba[d] = bytes[s + (bgra ? 2 : 0)]; rgba[d + 1] = bytes[s + 1]; rgba[d + 2] = bytes[s + (bgra ? 0 : 2)]; rgba[d + 3] = bytes[s + 3];
    }
  }
  return { width, height, rgba };
}

/** RGB at a pixel, clamped to the image. */
export function pixel(image, x, y) {
  const px = Math.max(0, Math.min(image.width - 1, Math.round(x)));
  const py = Math.max(0, Math.min(image.height - 1, Math.round(y)));
  const o = (py * image.width + px) * 4;
  return [image.rgba[o], image.rgba[o + 1], image.rgba[o + 2]];
}

/** Mean RGB over a small box, to ride out filtering at a sample point. */
export function meanBox(image, x, y, radius = 2) {
  const sum = [0, 0, 0];
  let n = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const p = pixel(image, x + dx, y + dy);
      sum[0] += p[0]; sum[1] += p[1]; sum[2] += p[2]; n++;
    }
  }
  return sum.map((v) => v / n);
}

/** Picture statistics over a rectangle (default: all of it), sampled on a grid. */
export function stats(image, rect = null, step = 2) {
  const x0 = Math.max(0, Math.floor(rect?.x ?? 0)), y0 = Math.max(0, Math.floor(rect?.y ?? 0));
  const x1 = Math.min(image.width, Math.ceil((rect?.x ?? 0) + (rect?.width ?? image.width)));
  const y1 = Math.min(image.height, Math.ceil((rect?.y ?? 0) + (rect?.height ?? image.height)));
  let n = 0, lumaSum = 0, maxLuma = 0, nonBlack = 0;
  const colours = new Set();
  const mean = [0, 0, 0];
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      const o = (y * image.width + x) * 4;
      const r = image.rgba[o], g = image.rgba[o + 1], b = image.rgba[o + 2];
      const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      lumaSum += luma; if (luma > maxLuma) maxLuma = luma;
      if (r > 8 || g > 8 || b > 8) nonBlack++;
      mean[0] += r; mean[1] += g; mean[2] += b;
      if (colours.size < 4096) colours.add((r >> 3) << 10 | (g >> 3) << 5 | (b >> 3));
      n++;
    }
  }
  const round = (v) => Math.round(v * 10000) / 10000;
  return {
    samples: n, meanLuma: round(lumaSum / Math.max(1, n)), maxLuma: round(maxLuma),
    nonBlackFraction: round(nonBlack / Math.max(1, n)), distinctColours: colours.size,
    meanRgb: mean.map((v) => Math.round((v / Math.max(1, n)) * 10) / 10),
  };
}

export const srgbToLinear = (v) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };

/** Mean absolute RGB difference between two same-sized images, 0..255. */
export function meanDifference(a, b, step = 4) {
  if (a.width !== b.width || a.height !== b.height) return 255;
  let sum = 0, n = 0;
  for (let i = 0; i < a.rgba.length; i += 4 * step) {
    sum += Math.abs(a.rgba[i] - b.rgba[i]) + Math.abs(a.rgba[i + 1] - b.rgba[i + 1]) + Math.abs(a.rgba[i + 2] - b.rgba[i + 2]);
    n += 3;
  }
  return Math.round((sum / Math.max(1, n)) * 100) / 100;
}
