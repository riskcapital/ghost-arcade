// Scans arriving from a paired phone (desktop side).
//
// The protocol and its checks live in mobile/studio/scanTransfer.ts; the file
// itself is written by the main process (electron/phone-scan-store.cjs), which
// picks the folder and the name. This module joins the two to the app: the
// accept prompt, the list shown in the Media Library, and "Add as Point Cloud
// layer".
//
// Default: ASK before receiving. Pairing proves a device once scanned the QR
// code, not that the person at the desktop wants this file now, and the
// pairing code does not change between sessions. A received file also costs
// disk space (up to 64 MB each). "Always accept" is one checkbox away for a
// performer who scans and sends often.
import { get, writable } from 'svelte/store';
import {
  ScanReceiver, scanTransferCapability,
  type ReceivedScan, type ScanOfferSummary, type ScanReceiveView, type ScanSink, type ScanStatus,
} from '$lib/mobile/studio/scanTransfer';
import { pathToFileUrl } from '$lib/storage/assetRegistry';
import { project } from './layers';
import type { SplatContent } from '$lib/types';

export interface PhoneScan {
  name: string;
  path: string;
  bytes: number;
  points?: number;
  /** Set for scans that arrived in this session, newest highlighted in the library. */
  receivedAt?: number;
}

/** Offers waiting for the desktop user's answer. */
export const phoneScanOffers = writable<ScanOfferSummary[]>([]);
/** Transfers in flight. */
export const phoneScanTransfers = writable<ScanReceiveView[]>([]);
/** Scans in the Phone Scans folder, newest first. */
export const phoneScanLibrary = writable<PhoneScan[]>([]);
/** The scan that just arrived, for the "Add as Point Cloud layer" notice. */
export const phoneScanArrived = writable<PhoneScan | null>(null);

const AUTO_ACCEPT_KEY = 'ghost-arcade_auto_accept_phone_scans';
export function phoneScanAutoAccept(): boolean {
  try { return localStorage.getItem(AUTO_ACCEPT_KEY) === '1'; } catch { return false; }
}
export function setPhoneScanAutoAccept(on: boolean) {
  try { if (on) localStorage.setItem(AUTO_ACCEPT_KEY, '1'); else localStorage.removeItem(AUTO_ACCEPT_KEY); } catch { /* private mode */ }
}

type Invoke = (channel: string, args?: unknown) => Promise<any>;
const invoker = (): Invoke | null => (globalThis as { electronAPI?: { invoke?: Invoke } }).electronAPI?.invoke ?? null;
async function call(channel: string, args?: unknown) {
  const invoke = invoker();
  if (!invoke) throw new Error('Scans can be received in the desktop app only.');
  const result = await invoke(channel, args);
  if (!result?.success) throw new Error(result?.error || 'The desktop could not save the scan.');
  return result;
}
const sink: ScanSink = {
  begin: async (name, bytes) => { const r = await call('phone_scan_begin', { name, bytes }); return { id: r.id, name: r.name }; },
  write: async (id, offset, data) => { await call('phone_scan_write', { id, offset, bytes: data }); },
  finish: async (id, sha256) => { const r = await call('phone_scan_finish', { id, sha256 }); return { path: r.path, name: r.name, bytes: r.bytes }; },
  abort: async (id) => { await call('phone_scan_abort', { id }); },
};

const answers = new Map<string, (accept: boolean) => void>();
let receiver: ScanReceiver | null = null;
let sendStatus: (status: ScanStatus) => void = () => {};
let sweeper: ReturnType<typeof setInterval> | undefined;

function ensureReceiver(): ScanReceiver {
  if (receiver) return receiver;
  receiver = new ScanReceiver({
    sink,
    send: (status) => sendStatus(status),
    confirm: (offer) => {
      if (phoneScanAutoAccept()) return Promise.resolve(true);
      return new Promise<boolean>((resolve) => {
        answers.set(offer.requestId, resolve);
        phoneScanOffers.update((list) => [...list.filter((o) => o.requestId !== offer.requestId), offer]);
      });
    },
    onSaved: (scan: ReceivedScan) => {
      const entry: PhoneScan = { name: scan.name, path: scan.path, bytes: scan.bytes, points: scan.points, receivedAt: Date.now() };
      phoneScanLibrary.update((list) => [entry, ...list.filter((s) => s.path !== entry.path)]);
      phoneScanArrived.set(entry);
    },
    onChange: (transfers) => {
      phoneScanTransfers.set(transfers.filter((t) => t.state === 'receiving'));
      // An offer the phone withdrew (or that expired) no longer needs an answer.
      const asking = new Set(transfers.filter((t) => t.state === 'asking').map((t) => t.requestId));
      for (const [requestId, resolve] of [...answers]) {
        if (!asking.has(requestId)) { answers.delete(requestId); resolve(false); }
      }
      phoneScanOffers.update((list) => list.filter((o) => asking.has(o.requestId)));
    },
  });
  sweeper = setInterval(() => void receiver?.sweep(), 15_000);
  return receiver;
}

/** What this desktop tells a phone it can receive (goes into studio_capabilities). */
export const phoneScanCapability = scanTransferCapability;

/** Feed every studio_scan_* message from the pairing server through here. */
export function handlePhoneScanMessage(message: Record<string, unknown>, send: (status: ScanStatus) => void) {
  sendStatus = send;
  void ensureReceiver().handle(message);
}

export function answerPhoneScanOffer(requestId: string, accept: boolean) {
  const resolve = answers.get(requestId);
  answers.delete(requestId);
  phoneScanOffers.update((list) => list.filter((o) => o.requestId !== requestId));
  resolve?.(accept);
}

export function cancelPhoneScanTransfer(requestId: string) {
  void receiver?.cancel(requestId);
}

/** Read the Phone Scans folder so earlier scans are in the library after a restart. */
export async function loadPhoneScanLibrary() {
  if (!invoker()) return;
  try {
    const result = await call('phone_scan_list');
    const arrived = new Map(get(phoneScanLibrary).map((s) => [s.path, s]));
    phoneScanLibrary.set((result.scans as PhoneScan[]).map((s) => ({ ...s, ...(arrived.get(s.path) ?? {}) })));
  } catch { /* the library simply stays as it is */ }
}

/** New Point Cloud layer showing this scan. Returns false when a layer could not be added. */
export function addPhoneScanAsLayer(scan: PhoneScan): boolean {
  const before = new Set(get(project).layers.map((l) => l.id));
  project.addSplatLayer(scan.name.replace(/\.ply$/i, ''));
  const layer = get(project).layers.find((l) => !before.has(l.id) && l.type === 'splat');
  if (!layer) return false;
  project.updateSplatContent(layer.id, {
    filePath: pathToFileUrl(scan.path),
    dataType: 'pointcloud',
    pointCount: 0,
    activePointCount: 0,
    sourcePointCount: 0,
    _originalFileName: scan.name,
    _assetRef: { kind: 'local-file', originalPath: scan.path, name: scan.name, size: scan.bytes },
  } as Partial<SplatContent>);
  return true;
}

export function disposePhoneScans() {
  clearInterval(sweeper);
  sweeper = undefined;
  void receiver?.dispose();
  receiver = null;
}
