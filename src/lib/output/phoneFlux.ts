/**
 * Flux on the desktop's outputs, played from a paired phone.
 *
 * The phone sends where its finger is on the Flux pad and which modules are
 * on; the render core's output stage applies the same effect the phone
 * shows (see flux_apply in heartbeat.wgsl), on the Output Window and every
 * Screen. The wet amount is eased here so a touch fades in and out instead
 * of snapping, and Flux switches itself off if the phone stops talking, so
 * a dropped connection never leaves an effect stuck on a projector.
 */
import { submitNativeRendererCommands } from '../api/native-renderer';

/** Order is the bit order the shader reads. Keep in step with FLUX_MODULES in mobile/studio/flux.ts. */
export const FLUX_MODULE_BITS = ['warp', 'fold', 'prism', 'echo', 'solar', 'slice', 'tile', 'tunnel', 'pixel', 'glitch', 'ink', 'throb'] as const;

export type PhoneFlux = { x: number; y: number; energy: number; mix: number; blend: number; active: boolean; beat: boolean; modules: string[] };

const SILENCE_MS = 4000;
const unit = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback);

/** What the phone sent, with every field checked: a paired client is not trusted to send sane numbers. */
export function readPhoneFlux(message: Record<string, unknown>): PhoneFlux {
  const modules = Array.isArray(message.modules) ? message.modules.filter((m): m is string => typeof m === 'string' && (FLUX_MODULE_BITS as readonly string[]).includes(m)) : [];
  const blend = typeof message.blend === 'number' && Number.isFinite(message.blend) ? Math.max(0, Math.min(6, Math.round(message.blend))) : 0;
  return { x: unit(message.x, 0.5), y: unit(message.y, 0.5), energy: unit(message.energy, 0), mix: unit(message.mix, 0.8), blend, active: message.active === true && modules.length > 0, beat: message.beat === true, modules: [...new Set(modules)] };
}

export function fluxModuleBits(modules: string[]): number {
  return modules.reduce((bits, id) => { const bit = (FLUX_MODULE_BITS as readonly string[]).indexOf(id); return bit < 0 ? bits : bits | (1 << bit); }, 0);
}

/** One step of the fade toward the target wet amount, at about the phone's own rate. */
export function easeFluxGain(gain: number, target: number, seconds: number): number {
  const next = gain + (target - gain) * (1 - Math.exp(-Math.max(0, seconds) * 22));
  return Math.abs(next - target) < 0.002 ? target : next;
}

let state: PhoneFlux | null = null;
/** True while the VJ panel's own Flux pad is playing: it never times out. */
let deskControl = false;
let gain = 0;
let lastHeard = 0;
let lastStep = 0;
let timer: ReturnType<typeof setInterval> | undefined;
let lastSent = '';

type Corners = { topLeft: { x: number; y: number }; topRight: { x: number; y: number }; bottomLeft: { x: number; y: number }; bottomRight: { x: number; y: number } };
type ScreenLike = { type?: string; visible?: boolean; corners?: Corners };

/**
 * Each visible Screen's box in composition UV (x0, y0, x1, y1), y up, at most
 * 16. Flux plays inside each Screen on its own, so a Fold or Tile repeats
 * within every screen of a stage instead of warping the stage as a whole.
 */
export function fluxRegionsFromLayers(layers: readonly ScreenLike[]): number[][] {
  const regions: number[][] = [];
  for (const layer of layers) {
    if (layer.type !== 'screen' || layer.visible === false || !layer.corners) continue;
    const c = layer.corners;
    const xs = [c.topLeft.x, c.topRight.x, c.bottomLeft.x, c.bottomRight.x];
    const ys = [c.topLeft.y, c.topRight.y, c.bottomLeft.y, c.bottomRight.y];
    if (![...xs, ...ys].every(Number.isFinite)) continue;
    const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map((v) => Math.round(Math.max(0, Math.min(1, v)) * 1e4) / 1e4);
    if (box[2] - box[0] < 1e-3 || box[3] - box[1] < 1e-3) continue;
    regions.push(box);
    if (regions.length === 16) break;
  }
  return regions;
}

/**
 * The boxes Flux plays in right now. In VJ mode the Screens only slice the
 * picture in Stage mode; in Mix (and Map) Flux plays on the whole mix. In
 * Mapping mode the Screens are the slices.
 */
export function fluxRegionsFor(vj: { isOpen?: boolean; stageMode?: boolean } | null | undefined, layers: readonly ScreenLike[]): number[][] {
  if (vj?.isOpen && !vj.stageMode) return [];
  return fluxRegionsFromLayers(layers);
}

let regionsSource: () => number[][] = () => [];
/** Where the Screen boxes come from (App.svelte passes the project's layers). */
export function setFluxRegionsSource(source: () => number[][]) { regionsSource = source; }

function send() {
  const s = state;
  let regions: number[][] = [];
  try { regions = regionsSource(); } catch { /* no project yet */ }
  const command = { type: 'set_output_flux', x: s?.x ?? 0.5, y: s?.y ?? 0.5, energy: s?.energy ?? 0, gain, beat_lock: s?.beat ? 1 : 0, blend: s?.blend ?? 0, modules: s ? fluxModuleBits(s.modules) : 0, regions };
  const signature = JSON.stringify(command);
  if (signature === lastSent) return;
  lastSent = signature;
  void submitNativeRendererCommands([command as never]).catch(() => { lastSent = ''; });
}

function step() {
  const now = performance.now();
  const seconds = (now - lastStep) / 1000;
  lastStep = now;
  if (state && !deskControl && now - lastHeard > SILENCE_MS) state = { ...state, active: false };
  gain = easeFluxGain(gain, state?.active ? state.mix : 0, seconds);
  send();
  if (gain === 0 && !state?.active) { clearInterval(timer); timer = undefined; }
}

/** A `studio_flux` message from a paired phone. */
export function receivePhoneFlux(message: Record<string, unknown>) {
  deskControl = false;
  state = readPhoneFlux(message);
  lastHeard = performance.now();
  if (!timer) { lastStep = lastHeard; timer = setInterval(step, 16); }
  step();
}

/** Switch Flux off now (the phone left, or the operator asked). */
export function stopPhoneFlux() {
  if (state) state = { ...state, active: false };
  if (!timer && gain > 0) { lastStep = performance.now(); timer = setInterval(step, 16); }
}

/**
 * Flux from the VJ panel's own pad on this computer. Same effect and fade as
 * the phone's, without the silence timeout. An idle pad never takes Flux away
 * from a phone that is playing it.
 */
export function setDeskFlux(message: Record<string, unknown>) {
  const next = readPhoneFlux(message);
  if (!next.active && !deskControl) return;
  deskControl = next.active;
  state = next;
  lastHeard = performance.now();
  if (!timer) { lastStep = lastHeard; timer = setInterval(step, 16); }
  step();
}
