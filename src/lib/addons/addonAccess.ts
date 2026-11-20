/**
 * The paid add-ons, renderer side: Audio Lab and Analog Synth ship in the
 * app and stay locked until this computer has a licence or a trial for them.
 *
 * The main process owns the licence (electron/addons/entitlement.cjs): it
 * checks the signed entitlement, and it decides what is usable. Its answer
 * reaches here when the app starts (read synchronously by the preload, so a
 * project's add-on layers are right from the first frame), when a project
 * opens, and after the user acts in Settings → Add-ons. An add-on that was
 * usable once in this run stays usable until the app quits: the main
 * process keeps that promise, so a reloaded editor keeps it too.
 *
 * Every entry point asks `addonUsable()` (or the `addonAccess` store):
 * registry cards, the VJ dock button, the deck strip, the studio view key,
 * the layer panels, param discovery, MIDI and the render routing.
 */
import { derived, get, writable, type Readable } from 'svelte/store';
import { showToast } from '../stores/errorToast';

export type AddonProductId = 'addon.audio-lab' | 'addon.analog-synth';

export const ADDON_PRODUCT_IDS: readonly AddonProductId[] = ['addon.audio-lab', 'addon.analog-synth'];

export interface AddonProduct {
  id: AddonProductId;
  name: string;
  /** One-time price in US dollars, as the website sells it. */
  price: number;
  /** The effect type its layers carry. */
  effectType: string;
}

export const ADDON_PRODUCTS: Readonly<Record<AddonProductId, AddonProduct>> = {
  'addon.audio-lab': { id: 'addon.audio-lab', name: 'Audio Lab', price: 25, effectType: 'music-studio' },
  'addon.analog-synth': { id: 'addon.analog-synth', name: 'Analog Synth', price: 10, effectType: 'videosynth' },
};

export const ADDON_TRIAL_DAYS = 3;
export const ADDONS_PAGE_URL = 'https://ghostarcade.live/addons';
export const ADDONS_ACCOUNT_URL = 'https://ghostarcade.live/account/addons';

/** One add-on on this computer. Exactly one of these at a time. */
export type AddonState =
  | { kind: 'locked' }
  | { kind: 'trial'; daysLeft: number; endsAt: string }
  | { kind: 'licensed' }
  | { kind: 'expired'; why: 'trial-ended' | 'offline' }
  | { kind: 'offline-grace'; daysLeft: number };

export interface AddonAccessEntry {
  state: AddonState;
  /** Can be used in this run (it was usable at some point since the app started). */
  usable: boolean;
}

export interface AddonLicenceInfo {
  /** The licence key, masked (GA-••••-••••-••••-AB12), or null. */
  key: string | null;
  email: string | null;
  /** When the website last confirmed the licence (ISO). */
  checkedAt: string | null;
  /** When it stops working without a check-in (ISO). */
  validUntil: string | null;
  emergency: { available: boolean; until: string | null };
}

export interface AddonsStatus {
  products: Record<AddonProductId, AddonAccessEntry>;
  licence: AddonLicenceInfo | null;
  /** The stored entitlement didn't check out: signed for another computer, unknown key, bad signature. */
  problem: 'other-computer' | 'unknown_key' | 'signature' | 'format' | null;
  /** Days left offline when an add-on is in its grace period. */
  offlineDaysLeft: number | null;
  machine: { name: string; id: string };
  /** A development licence server, when not ghostarcade.live. */
  server: string | null;
}

/** Why an action failed, as the main process reports it. */
export type AddonActionCode =
  | 'network' | 'invalid_key' | 'licence_inactive' | 'machine_limit' | 'signing_unavailable'
  | 'bad_request' | 'bad_key' | 'bad_reply' | 'server' | 'no_key' | 'not_available'
  | 'machine_not_activated' | 'unavailable';

export interface AddonSeat { id: string; hostname: string | null; activatedAt: string | null; lastSeenAt: string | null }

export type AddonActionResult =
  | { ok: true; status: AddonsStatus }
  | { ok: false; code: AddonActionCode; maxMachines?: number; machines?: AddonSeat[]; status?: AddonsStatus };

const LOCKED: AddonAccessEntry = { state: { kind: 'locked' }, usable: false };

function lockedStatus(): AddonsStatus {
  return {
    products: { 'addon.audio-lab': LOCKED, 'addon.analog-synth': LOCKED },
    licence: null,
    problem: null,
    offlineDaysLeft: null,
    machine: { name: '', id: '' },
    server: null,
  };
}

const KINDS = new Set(['locked', 'trial', 'licensed', 'expired', 'offline-grace']);

/** A status from the main process, checked field by field; anything odd reads as locked. */
export function normalizeAddonsStatus(raw: unknown): AddonsStatus {
  const base = lockedStatus();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<AddonsStatus>;
  for (const id of ADDON_PRODUCT_IDS) {
    const entry = r.products?.[id];
    if (entry && typeof entry === 'object' && entry.state && KINDS.has(entry.state.kind)) {
      base.products[id] = { state: entry.state, usable: entry.usable === true };
    }
  }
  base.licence = r.licence && typeof r.licence === 'object' ? r.licence : null;
  base.problem = r.problem ?? null;
  base.offlineDaysLeft = typeof r.offlineDaysLeft === 'number' ? r.offlineDaysLeft : null;
  if (r.machine && typeof r.machine === 'object') base.machine = { name: String(r.machine.name ?? ''), id: String(r.machine.id ?? '') };
  base.server = typeof r.server === 'string' ? r.server : null;
  return base;
}

function launchStatus(): AddonsStatus {
  if (typeof window === 'undefined') return lockedStatus();
  const bridge = (window as unknown as { ghostAddons?: { launch?: unknown } }).ghostAddons;
  return normalizeAddonsStatus(bridge?.launch ?? null);
}

const status = writable<AddonsStatus>(launchStatus());

/** Everything Settings → Add-ons shows. */
export const addonsStatus: Readable<AddonsStatus> = { subscribe: status.subscribe };

/** Which add-ons can be used now, by product id. Changes only when access changes. */
export const addonAccess: Readable<Record<AddonProductId, boolean>> = derived(status, ($s, set) => {
  set({ 'addon.audio-lab': $s.products['addon.audio-lab'].usable, 'addon.analog-synth': $s.products['addon.analog-synth'].usable });
}, { 'addon.audio-lab': false, 'addon.analog-synth': false } as Record<AddonProductId, boolean>);

let usable: Record<AddonProductId, boolean> = { 'addon.audio-lab': false, 'addon.analog-synth': false };
addonAccess.subscribe((value) => { usable = value; });

/** True when this add-on can be used now. Synchronous: safe in render paths. */
export function addonUsable(id: AddonProductId): boolean {
  return usable[id] === true;
}

/** The add-on an effect type belongs to, or null for one that is built in. */
export function addonForEffectType(effectType: unknown): AddonProduct | null {
  const type = String(effectType ?? '').trim().toLowerCase();
  for (const id of ADDON_PRODUCT_IDS) if (ADDON_PRODUCTS[id].effectType === type) return ADDON_PRODUCTS[id];
  return null;
}

/** Apply a status from the main process. A usable add-on never turns unusable here within a run. */
export function applyAddonsStatus(raw: unknown): AddonsStatus {
  const next = normalizeAddonsStatus(raw);
  const prev = get(status);
  for (const id of ADDON_PRODUCT_IDS) {
    if (prev.products[id].usable && !next.products[id].usable) next.products[id] = { ...next.products[id], usable: true };
  }
  status.set(next);
  return next;
}

type Invoke = (command: string, args?: unknown) => Promise<unknown>;
function bridgeInvoke(): Invoke | null {
  if (typeof window === 'undefined') return null;
  const api = (window as unknown as { electronAPI?: { invoke?: Invoke } }).electronAPI;
  return api?.invoke ? api.invoke.bind(api) : null;
}

/**
 * The look taken when a project opens (and Settings → Add-ons opens): the
 * current status, plus a quiet refresh in the main process when one is due.
 */
export async function checkAddons(): Promise<AddonsStatus> {
  const invoke = bridgeInvoke();
  if (!invoke) return get(status);
  try {
    const next = applyAddonsStatus(await invoke('addons_status', { checkpoint: true }));
    warnIfOffline(next);
    return next;
  } catch {
    return get(status);
  }
}

const OFFLINE_WARNING = { message: 'Add-ons: connect to the internet within {0} days so ghostarcade.live can check your licence.' };
let offlineWarned = false;

/** From day 23 without a check-in: one quiet note per run (never a dialog). */
export function warnIfOffline(s: AddonsStatus = get(status)): void {
  if (offlineWarned || s.offlineDaysLeft === null) return;
  offlineWarned = true;
  showToast(OFFLINE_WARNING.message.replace('{0}', String(s.offlineDaysLeft)), 'warning');
}

async function act(command: string, args?: unknown): Promise<AddonActionResult> {
  const invoke = bridgeInvoke();
  if (!invoke) return { ok: false, code: 'unavailable' };
  let result: AddonActionResult;
  try {
    result = (await invoke(command, args)) as AddonActionResult;
  } catch {
    return { ok: false, code: 'unavailable' };
  }
  if (!result || typeof result !== 'object') return { ok: false, code: 'server' };
  if (result.status) applyAddonsStatus(result.status);
  return result;
}

export const activateAddonLicence = (licenceKey: string) => act('addons_activate', { licenceKey });
export const freeAddonSeat = (licenceKey: string, machineRecordId: string) => act('addons_free_seat', { licenceKey, machineRecordId });
export const refreshAddonLicence = () => act('addons_refresh');
export const deactivateAddonLicence = () => act('addons_deactivate');
export const extendAddonLicence = () => act('addons_extend');

// ─── Offers: Try / Buy from any locked entry point ────────────────────────

/**
 * The add-on whose offer dialog is open, or null. `step` 'trial': the
 * website was opened for the trial and the dialog waits for the key.
 */
export const addonOffer = writable<{ product: AddonProductId; step: 'offer' | 'trial' } | null>(null);

/** A locked button or key asks for this add-on: show its offer. */
export function offerAddon(id: AddonProductId): void {
  addonOffer.set({ product: id, step: 'offer' });
}

function openSite(url: string): void {
  const invoke = bridgeInvoke();
  if (invoke) void invoke('open_external_url', { url }).catch(() => {});
  else if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener');
}

export function buyAddon(_id: AddonProductId): void {
  openSite(ADDONS_PAGE_URL);
}

/**
 * The trial needs an account, so it starts on the website: sign in there
 * and press Try free. The licence key the website then shows goes into the
 * offer dialog (or Settings → Add-ons) on this computer.
 */
export function startAddonTrial(id: AddonProductId): void {
  openSite(ADDONS_PAGE_URL);
  addonOffer.set({ product: id, step: 'trial' });
}

export function manageAddonsOnline(): void {
  openSite(ADDONS_ACCOUNT_URL);
}

/** Open Settings at the Add-ons page. */
export function openAddonsSettings(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('open-settings'));
  setTimeout(() => window.dispatchEvent(new CustomEvent('ga-settings-section', { detail: { section: 'app:addons' } })), 0);
}

/** For tests: set the status as if the main process had sent it. */
export function setAddonsStatusForTests(next: Partial<Record<AddonProductId, boolean>>): void {
  const s = lockedStatus();
  for (const id of ADDON_PRODUCT_IDS) {
    if (next[id]) s.products[id] = { state: { kind: 'licensed' }, usable: true };
  }
  status.set(s);
}
