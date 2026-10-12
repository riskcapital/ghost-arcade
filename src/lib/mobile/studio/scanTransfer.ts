// Sending a saved LiDAR scan from the phone to the paired desktop.
//
// This file is shared byte for byte by the desktop and mobile branches: the
// phone half (ScanSender) and the desktop half (ScanReceiver) are one protocol
// and are tested against each other in scanTransfer.test.ts.
//
// Wire protocol (JSON over the pairing WebSocket; the server relays, it never
// stores or opens anything):
//   phone   -> studio_capabilities_request
//   desktop -> studio_capabilities { ..., scanTransfer: { version, maxBytes, chunkBytes } }
//   phone   -> studio_scan_offer  { requestId, version, name, bytes, points, sha256, chunkBytes, voxelMm?, sizeM?, preset? }
//   desktop -> studio_scan_status { requestId, state, next?, received?, name?, error? }
//   phone   -> studio_scan_chunk  { requestId, index, crc32, data (base64) }
//   phone   -> studio_scan_abort  { requestId }
// States: waiting (the desktop is asking its user), ready / progress (send
// chunk `next`), saved, declined, failed, aborted. The phone sends chunk N only
// after a status that names N, so a lost message stalls instead of corrupting,
// a bad chunk is simply asked for again, and a transfer resumes from `next`
// when the same file is offered again after a reconnect.
// A desktop without scanTransfer in its capabilities (or with no answer at
// all) cannot receive scans: the phone says so and opens the share sheet.

export const SCAN_TRANSFER_VERSION = 1;
/** Raw bytes per chunk. As base64 JSON this is about 1.4 MB, well under the
 *  pairing server's 10 MB message limit. */
export const SCAN_CHUNK_BYTES = 1024 * 1024;
/** Largest scan a desktop takes. A Detail scan is 1.5M points x 15 bytes = 22.5 MB. */
export const SCAN_MAX_BYTES = 64 * 1024 * 1024;
export const SCAN_MIN_CHUNK_BYTES = 16 * 1024;
export const SCAN_MAX_CHUNK_BYTES = 2 * 1024 * 1024;
export const SCAN_NAME_MAX = 80;

export type ScanTransferCapability = { version: number; maxBytes: number; chunkBytes: number };
export type ScanOffer = {
  type: 'studio_scan_offer'; requestId: string; version: number; name: string; bytes: number; points: number;
  sha256: string; chunkBytes: number; voxelMm?: number; sizeM?: [number, number, number]; preset?: string;
};
export type ScanChunk = { type: 'studio_scan_chunk'; requestId: string; index: number; crc32: number; data: string };
export type ScanStatusState = 'waiting' | 'ready' | 'progress' | 'saved' | 'declined' | 'failed' | 'aborted';
export type ScanStatus = {
  type: 'studio_scan_status'; requestId: string; state: ScanStatusState;
  next?: number; received?: number; name?: string; error?: string;
};
export const SCAN_TERMINAL_STATES: readonly ScanStatusState[] = ['saved', 'declined', 'failed', 'aborted'];

export function scanTransferCapability(): ScanTransferCapability {
  return { version: SCAN_TRANSFER_VERSION, maxBytes: SCAN_MAX_BYTES, chunkBytes: SCAN_CHUNK_BYTES };
}

/** What a desktop said it can take, or null for one that cannot receive scans. */
export function readScanTransferCapability(message: unknown): ScanTransferCapability | null {
  const cap = (message as { scanTransfer?: Partial<ScanTransferCapability> } | null)?.scanTransfer;
  if (!cap || typeof cap !== 'object') return null;
  const version = Number(cap.version), maxBytes = Number(cap.maxBytes), chunkBytes = Number(cap.chunkBytes);
  if (!Number.isInteger(version) || version < 1 || !(maxBytes > 0) || !(chunkBytes > 0)) return null;
  return { version, maxBytes, chunkBytes: Math.min(SCAN_MAX_CHUNK_BYTES, Math.max(SCAN_MIN_CHUNK_BYTES, Math.floor(chunkBytes))) };
}

/**
 * A file name that is safe to create inside one folder on any desktop: no
 * path, no control or reserved characters, no leading dot, not a Windows
 * device name, at most 80 characters, always ending in .ply. The desktop's
 * main process applies the same rule again before it creates the file.
 */
export function sanitizeScanName(raw: unknown): string {
  let name = String(raw ?? '').normalize('NFKC');
  name = name.split(/[\\/]/).pop() ?? '';
  name = name.replace(/\.ply$/i, '');
  name = name.replace(/[^A-Za-z0-9 ._()-]/g, '_').replace(/\s+/g, ' ').replace(/_{2,}/g, '_');
  name = name.replace(/^[ ._]+/, '').replace(/[ ._]+$/, '');
  if (name.length > SCAN_NAME_MAX) name = name.slice(0, SCAN_NAME_MAX).replace(/[ ._]+$/, '');
  if (!name) name = 'Scan';
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(name.split('.')[0])) name = `_${name}`;
  return `${name}.ply`;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000) as unknown as number[]);
  }
  return btoa(binary);
}
/** Strict: anything that is not plain base64 returns null instead of garbage. */
export function base64ToBytes(text: string): Uint8Array | null {
  if (typeof text !== 'string' || text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) return null;
  try {
    const binary = atob(text);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

const SHA_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
  0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
  0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
/** SHA-256 in plain script, for WebViews where crypto.subtle is not offered. */
export function sha256HexSync(bytes: Uint8Array): string {
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const total = bytes.length;
  const padded = new Uint8Array(((total + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[total] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(total / 0x20000000), false);
  view.setUint32(padded.length - 4, (total << 3) >>> 0, false);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15], b = w[i - 2];
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const s1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const t1 = (hh + s1 + ((e & f) ^ (~e & g)) + SHA_K[i] + w[i]) >>> 0;
      const s0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const t2 = (s0 + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  return Array.from(h, (v) => v.toString(16).padStart(8, '0')).join('');
}
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  try {
    const subtle = (globalThis as { crypto?: Crypto }).crypto?.subtle;
    if (subtle) {
      const digest = await subtle.digest('SHA-256', bytes as unknown as BufferSource);
      return Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, '0')).join('');
    }
  } catch { /* fall through to the script version */ }
  return sha256HexSync(bytes);
}

// ── Phone side ──────────────────────────────────────────────────────────

export type ScanSocket = {
  readyState: number;
  send(data: string): void;
  addEventListener(type: 'message' | 'close', listener: (event: any) => void): void;
  removeEventListener(type: 'message' | 'close', listener: (event: any) => void): void;
};
export type ScanSendProgress = { phase: 'checking' | 'waiting' | 'sending'; sent: number; total: number };
export type ScanSendOutcome = {
  state: 'saved' | 'declined' | 'failed' | 'aborted' | 'unsupported';
  message: string;
  /** File name the desktop saved it under. */
  name?: string;
};
export type ScanSendOptions = {
  socket: ScanSocket;
  bytes: Uint8Array;
  name: string;
  points: number;
  voxelMm?: number;
  sizeM?: [number, number, number];
  preset?: string;
  /** Reuse the id of an interrupted send so the desktop does not ask again. */
  requestId?: string;
  onProgress?: (progress: ScanSendProgress) => void;
  /** Test hooks. Defaults: 4 s for capabilities, 8 s for any answer, 3 tries. */
  capabilityMs?: number;
  answerMs?: number;
  tries?: number;
};
export const SCAN_UNSUPPORTED_MESSAGE = 'This desktop cannot receive scans yet. Update Ghost Arcade on the desktop, or share the file instead.';
const SOCKET_OPEN = 1;

export function newScanRequestId(): string {
  const random = (globalThis as { crypto?: Crypto }).crypto;
  if (random?.randomUUID) return random.randomUUID();
  const bytes = new Uint8Array(16);
  if (random?.getRandomValues) random.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (v) => v.toString(16).padStart(2, '0')).join('');
}

/** Send one scan. `done` always resolves (never rejects) with a plain outcome. */
export function sendScan(options: ScanSendOptions): { done: Promise<ScanSendOutcome>; abort: () => void; requestId: string } {
  const { socket, bytes } = options;
  const requestId = options.requestId || newScanRequestId();
  const capabilityMs = options.capabilityMs ?? 4000, answerMs = options.answerMs ?? 8000, tries = options.tries ?? 3;
  const total = bytes.length;
  let finish: (outcome: ScanSendOutcome) => void = () => {};
  let settled = false, offer: ScanOffer | null = null, started = false;
  let timer: ReturnType<typeof setTimeout> | undefined, capabilityPoll: ReturnType<typeof setInterval> | undefined;
  let silent = 0, lastIndex = -1, repeats = 0;
  const progress = (phase: ScanSendProgress['phase'], sent: number) => options.onProgress?.({ phase, sent: Math.min(sent, total), total });
  const post = (message: Record<string, unknown>) => {
    if (socket.readyState !== SOCKET_OPEN) return false;
    try { socket.send(JSON.stringify(message)); return true; } catch { return false; }
  };
  const end = (outcome: ScanSendOutcome) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer); clearInterval(capabilityPoll);
    socket.removeEventListener('message', receive);
    socket.removeEventListener('close', closed);
    finish(outcome);
  };
  const closed = () => end({ state: 'failed', message: 'Desktop disconnected. Send again to carry on where it stopped.' });
  /** No answer for a while: ask again where to continue, a few times, then stop. */
  const expectAnswer = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (settled || !offer) return;
      if (++silent >= tries) { post({ type: 'studio_scan_abort', requestId }); end({ state: 'failed', message: 'The desktop stopped answering. Check it and send again.' }); return; }
      post(offer); expectAnswer();
    }, answerMs);
  };
  const sendChunk = (index: number) => {
    if (!offer) return;
    const chunks = Math.ceil(total / offer.chunkBytes);
    if (!Number.isInteger(index) || index < 0 || index >= chunks) return;
    repeats = index === lastIndex ? repeats + 1 : 0;
    lastIndex = index;
    if (repeats > 4) { post({ type: 'studio_scan_abort', requestId }); end({ state: 'failed', message: 'The scan kept arriving damaged. Check the Wi-Fi connection and send again.' }); return; }
    const part = bytes.subarray(index * offer.chunkBytes, Math.min(total, (index + 1) * offer.chunkBytes));
    progress('sending', index * offer.chunkBytes);
    if (settled) return; // stopped from inside the progress callback
    post({ type: 'studio_scan_chunk', requestId, index, crc32: crc32(part), data: bytesToBase64(part) });
    expectAnswer();
  };
  const begin = async (capability: ScanTransferCapability) => {
    if (total > capability.maxBytes) { end({ state: 'failed', message: 'This scan is too large for the desktop to receive. Share the file instead.' }); return; }
    const sha256 = await sha256Hex(bytes);
    if (settled) return;
    offer = {
      type: 'studio_scan_offer', requestId, version: SCAN_TRANSFER_VERSION, name: sanitizeScanName(options.name), bytes: total,
      points: Math.max(0, Math.round(options.points) || 0), sha256, chunkBytes: Math.min(capability.chunkBytes, SCAN_CHUNK_BYTES),
      ...(options.voxelMm ? { voxelMm: options.voxelMm } : {}), ...(options.sizeM ? { sizeM: options.sizeM } : {}),
      ...(options.preset ? { preset: options.preset } : {}),
    };
    progress('waiting', 0);
    if (!post(offer)) { closed(); return; }
    expectAnswer();
  };
  function receive(event: { data: unknown }) {
    let message: any;
    try { message = JSON.parse(String(event.data)); } catch { return; }
    if (!message || typeof message !== 'object') return;
    if (message.type === 'studio_capabilities' && !started) {
      started = true;
      clearInterval(capabilityPoll); clearTimeout(timer);
      const capability = readScanTransferCapability(message);
      if (!capability) end({ state: 'unsupported', message: SCAN_UNSUPPORTED_MESSAGE });
      else void begin(capability);
      return;
    }
    if (message.type !== 'studio_scan_status' || message.requestId !== requestId || !offer) return;
    silent = 0;
    const state = message.state as ScanStatusState;
    if (state === 'waiting') {
      // The desktop is asking its user: give them time, not the short answer timeout.
      progress('waiting', 0); clearTimeout(timer);
      timer = setTimeout(() => { post({ type: 'studio_scan_abort', requestId }); end({ state: 'failed', message: 'Nobody accepted the scan on the desktop.' }); }, 120_000);
    } else if (state === 'ready' || state === 'progress') sendChunk(Number(message.next));
    else if (state === 'saved') { progress('sending', total); end({ state: 'saved', message: 'Saved on the desktop.', name: typeof message.name === 'string' ? message.name : undefined }); }
    else if (state === 'declined') end({ state: 'declined', message: 'The desktop declined the scan.' });
    else if (state === 'aborted') end({ state: 'aborted', message: 'Sending stopped.' });
    else if (state === 'failed') end({ state: 'failed', message: typeof message.error === 'string' && message.error ? message.error.slice(0, 200) : 'The desktop could not save the scan.' });
  }
  const done = new Promise<ScanSendOutcome>((resolve) => { finish = resolve; });
  if (socket.readyState !== SOCKET_OPEN) { settled = true; finish({ state: 'failed', message: 'Not connected to the desktop.' }); return { done, abort: () => {}, requestId }; }
  socket.addEventListener('message', receive);
  socket.addEventListener('close', closed);
  progress('checking', 0);
  post({ type: 'studio_capabilities_request' });
  capabilityPoll = setInterval(() => post({ type: 'studio_capabilities_request' }), 1000);
  // A desktop from before Interactive Studio never answers at all.
  timer = setTimeout(() => { if (!started) end({ state: 'unsupported', message: SCAN_UNSUPPORTED_MESSAGE }); }, capabilityMs);
  return {
    done, requestId,
    abort: () => { if (settled) return; if (offer) post({ type: 'studio_scan_abort', requestId }); end({ state: 'aborted', message: 'Sending stopped.' }); },
  };
}

// ── Desktop side ────────────────────────────────────────────────────────

/** Where the bytes go. The desktop's main process implements this: IT picks
 *  the folder and the final file name, never the phone. */
export interface ScanSink {
  begin(name: string, bytes: number): Promise<{ id: string; name: string }>;
  write(id: string, offset: number, data: Uint8Array): Promise<void>;
  /** Checks size and SHA-256, then moves the file into place. */
  finish(id: string, sha256: string): Promise<{ path: string; name: string; bytes: number }>;
  abort(id: string): Promise<void>;
}
export type ScanOfferSummary = {
  requestId: string; name: string; bytes: number; points: number;
  voxelMm?: number; sizeM?: [number, number, number]; preset?: string;
};
export type ReceivedScan = ScanOfferSummary & { path: string };
export type ScanReceiveView = { requestId: string; name: string; bytes: number; received: number; state: 'asking' | 'receiving' };
export type ScanReceiverOptions = {
  sink: ScanSink;
  send: (status: ScanStatus) => void;
  /** Ask the desktop user (or apply their standing choice). */
  confirm: (offer: ScanOfferSummary) => Promise<boolean>;
  onSaved: (scan: ReceivedScan) => void;
  onChange?: (transfers: ScanReceiveView[]) => void;
  now?: () => number;
  /** A transfer with no chunk for this long is dropped (default 2 minutes). */
  idleMs?: number;
};
type Transfer = {
  offer: ScanOffer; name: string; chunks: number; state: 'asking' | 'receiving';
  sinkId: string; next: number; received: number; bad: number; touched: number; queue: Promise<void>;
};
const REQUEST_ID = /^[\w.:-]{1,128}$/;
const MAX_OPEN_TRANSFERS = 3;
const MAX_BAD_CHUNKS = 5;

export function validScanOffer(message: any): ScanOffer | null {
  if (!message || typeof message !== 'object' || message.type !== 'studio_scan_offer') return null;
  const { requestId, version, name, bytes, points, sha256, chunkBytes } = message;
  if (typeof requestId !== 'string' || !REQUEST_ID.test(requestId)) return null;
  if (version !== SCAN_TRANSFER_VERSION) return null;
  if (typeof name !== 'string' || name.length > 300) return null;
  if (!Number.isInteger(bytes) || bytes < 16 || bytes > SCAN_MAX_BYTES) return null;
  if (!Number.isInteger(points) || points < 0 || points > 50_000_000) return null;
  if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) return null;
  if (!Number.isInteger(chunkBytes) || chunkBytes < SCAN_MIN_CHUNK_BYTES || chunkBytes > SCAN_MAX_CHUNK_BYTES) return null;
  const offer: ScanOffer = { type: 'studio_scan_offer', requestId, version, name: sanitizeScanName(name), bytes, points, sha256, chunkBytes };
  if (Number.isFinite(message.voxelMm) && message.voxelMm > 0 && message.voxelMm < 1000) offer.voxelMm = message.voxelMm;
  if (Array.isArray(message.sizeM) && message.sizeM.length === 3 && message.sizeM.every((v: unknown) => Number.isFinite(v) && (v as number) >= 0 && (v as number) < 10_000)) {
    offer.sizeM = [message.sizeM[0], message.sizeM[1], message.sizeM[2]];
  }
  if (typeof message.preset === 'string' && /^[\w -]{1,40}$/.test(message.preset)) offer.preset = message.preset;
  return offer;
}

export class ScanReceiver {
  private transfers = new Map<string, Transfer>();
  constructor(private options: ScanReceiverOptions) {}

  private now() { return this.options.now ? this.options.now() : Date.now(); }
  private status(requestId: string, state: ScanStatusState, extra: Partial<ScanStatus> = {}) {
    this.options.send({ type: 'studio_scan_status', requestId, state, ...extra });
  }
  private changed() {
    this.options.onChange?.([...this.transfers.entries()].map(([requestId, t]) => (
      { requestId, name: t.name, bytes: t.offer.bytes, received: t.received, state: t.state }
    )));
  }
  private summary(offer: ScanOffer): ScanOfferSummary {
    const { requestId, name, bytes, points, voxelMm, sizeM, preset } = offer;
    return { requestId, name, bytes, points, ...(voxelMm ? { voxelMm } : {}), ...(sizeM ? { sizeM } : {}), ...(preset ? { preset } : {}) };
  }
  private async drop(requestId: string) {
    const transfer = this.transfers.get(requestId);
    if (!transfer) return;
    this.transfers.delete(requestId);
    if (transfer.sinkId) await this.options.sink.abort(transfer.sinkId).catch(() => {});
    this.changed();
  }

  /** Every studio_scan_* message from a phone goes through here. */
  handle(message: any): Promise<void> {
    if (!message || typeof message !== 'object' || typeof message.requestId !== 'string' || !REQUEST_ID.test(message.requestId)) return Promise.resolve();
    if (message.type === 'studio_scan_offer') return this.offer(message);
    const transfer = this.transfers.get(message.requestId);
    if (!transfer) {
      // A chunk for a transfer this desktop no longer has: tell the phone to stop.
      if (message.type === 'studio_scan_chunk') this.status(message.requestId, 'failed', { error: 'The desktop is no longer receiving this scan. Send it again.' });
      return Promise.resolve();
    }
    // One message at a time per transfer: writes must land in order.
    transfer.queue = transfer.queue.then(async () => {
      if (this.transfers.get(message.requestId) !== transfer) return;
      if (message.type === 'studio_scan_abort') { await this.drop(message.requestId); this.status(message.requestId, 'aborted'); }
      else if (message.type === 'studio_scan_chunk') await this.chunk(message.requestId, transfer, message);
    }).catch(() => {});
    return transfer.queue;
  }

  private async offer(message: any) {
    const offer = validScanOffer(message);
    if (!offer) { this.status(message.requestId, 'failed', { error: 'The desktop could not read this scan offer.' }); return; }
    const known = this.transfers.get(offer.requestId);
    if (known) {
      // The phone asking again where to continue (after a stall or reconnect).
      if (known.offer.sha256 !== offer.sha256 || known.offer.bytes !== offer.bytes) { this.status(offer.requestId, 'failed', { error: 'This scan changed while it was being sent. Send it again.' }); await this.drop(offer.requestId); return; }
      known.touched = this.now();
      if (known.state === 'asking') this.status(offer.requestId, 'waiting');
      else this.status(offer.requestId, 'ready', { next: known.next, received: known.received });
      return;
    }
    if (this.transfers.size >= MAX_OPEN_TRANSFERS) { this.status(offer.requestId, 'failed', { error: 'The desktop is busy with other scans. Try again in a moment.' }); return; }
    const transfer: Transfer = {
      offer, name: offer.name, chunks: Math.ceil(offer.bytes / offer.chunkBytes), state: 'asking',
      sinkId: '', next: 0, received: 0, bad: 0, touched: this.now(), queue: Promise.resolve(),
    };
    this.transfers.set(offer.requestId, transfer);
    this.changed();
    this.status(offer.requestId, 'waiting');
    let accepted = false;
    try { accepted = await this.options.confirm(this.summary(offer)); } catch { accepted = false; }
    if (this.transfers.get(offer.requestId) !== transfer) return; // aborted or expired while asking
    if (!accepted) { await this.drop(offer.requestId); this.status(offer.requestId, 'declined'); return; }
    // The same file half received under another request (the phone reconnected
    // and started over): carry on from there instead of from zero.
    const partial = [...this.transfers.entries()].find(([id, t]) => id !== offer.requestId && t.state === 'receiving'
      && t.offer.sha256 === offer.sha256 && t.offer.bytes === offer.bytes && t.offer.chunkBytes === offer.chunkBytes);
    try {
      if (partial) {
        const [oldId, old] = partial;
        await old.queue;
        this.transfers.delete(oldId);
        Object.assign(transfer, { sinkId: old.sinkId, next: old.next, received: old.received, name: old.name });
      } else {
        const begun = await this.options.sink.begin(offer.name, offer.bytes);
        transfer.sinkId = begun.id; transfer.name = begun.name;
      }
    } catch (error) {
      await this.drop(offer.requestId);
      this.status(offer.requestId, 'failed', { error: error instanceof Error ? error.message : 'The desktop could not create the file.' });
      return;
    }
    transfer.state = 'receiving'; transfer.touched = this.now();
    this.changed();
    this.status(offer.requestId, 'ready', { next: transfer.next, received: transfer.received });
  }

  private async chunk(requestId: string, transfer: Transfer, message: any) {
    if (transfer.state !== 'receiving') return;
    transfer.touched = this.now();
    const again = () => this.status(requestId, 'progress', { next: transfer.next, received: transfer.received });
    if (message.index !== transfer.next) { again(); return; } // a repeat or out of order: say what is wanted
    const { offer } = transfer;
    const expected = Math.min(offer.chunkBytes, offer.bytes - transfer.next * offer.chunkBytes);
    const data = typeof message.data === 'string' && message.data.length <= Math.ceil(expected / 3) * 4 + 4 ? base64ToBytes(message.data) : null;
    if (!data || data.length !== expected || crc32(data) !== (Number(message.crc32) >>> 0)) {
      if (++transfer.bad > MAX_BAD_CHUNKS) { await this.drop(requestId); this.status(requestId, 'failed', { error: 'The scan kept arriving damaged. Check the Wi-Fi connection and send again.' }); return; }
      again(); return;
    }
    try {
      await this.options.sink.write(transfer.sinkId, transfer.received, data);
      transfer.next += 1; transfer.received += data.length;
      if (transfer.next < transfer.chunks) { this.changed(); again(); return; }
      const sinkId = transfer.sinkId;
      transfer.sinkId = ''; // finish() owns the file from here, pass or fail
      const saved = await this.options.sink.finish(sinkId, offer.sha256);
      this.transfers.delete(requestId);
      this.changed();
      this.status(requestId, 'saved', { name: saved.name, received: saved.bytes });
      this.options.onSaved({ ...this.summary(offer), name: saved.name, path: saved.path });
    } catch (error) {
      await this.drop(requestId);
      this.status(requestId, 'failed', { error: error instanceof Error ? error.message : 'The desktop could not save the scan.' });
    }
  }

  /** The desktop user cancels a transfer (or declines while it is still asking: resolve confirm with false instead). */
  async cancel(requestId: string) {
    if (!this.transfers.has(requestId)) return;
    await this.drop(requestId);
    this.status(requestId, 'declined');
  }

  /** Drop transfers that went quiet. Call it every few seconds. */
  async sweep() {
    const idleMs = this.options.idleMs ?? 120_000, now = this.now();
    for (const [requestId, transfer] of [...this.transfers]) {
      if (transfer.state === 'receiving' && now - transfer.touched > idleMs) {
        await this.drop(requestId);
        this.status(requestId, 'failed', { error: 'The scan stopped arriving. Send it again.' });
      }
    }
  }

  async dispose() {
    for (const requestId of [...this.transfers.keys()]) await this.drop(requestId);
  }
}
