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
let gain = 0;
let lastHeard = 0;
let lastStep = 0;
let timer: ReturnType<typeof setInterval> | undefined;
let lastSent = '';

function send() {
  const s = state;
  const command = { type: 'set_output_flux', x: s?.x ?? 0.5, y: s?.y ?? 0.5, energy: s?.energy ?? 0, gain, beat_lock: s?.beat ? 1 : 0, blend: s?.blend ?? 0, modules: s ? fluxModuleBits(s.modules) : 0 };
  const signature = JSON.stringify(command);
  if (signature === lastSent) return;
  lastSent = signature;
  void submitNativeRendererCommands([command as never]).catch(() => { lastSent = ''; });
}

function step() {
  const now = performance.now();
  const seconds = (now - lastStep) / 1000;
  lastStep = now;
  if (state && now - lastHeard > SILENCE_MS) state = { ...state, active: false };
  gain = easeFluxGain(gain, state?.active ? state.mix : 0, seconds);
  send();
  if (gain === 0 && !state?.active) { clearInterval(timer); timer = undefined; }
}

/** A `studio_flux` message from a paired phone. */
export function receivePhoneFlux(message: Record<string, unknown>) {
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
