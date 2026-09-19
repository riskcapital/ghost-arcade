import type { MidiDevice, MidiMapping, MidiStoreState } from './midiTypes';
import type { VJClipLauncherState, VJDeck } from '../stores/vjClipLauncher';
import type { ControllerLightsSettings } from './controllerLightsStore';
import { controllerProfiles, detectControllerProfile, type ControllerProfile } from './controllerProfiles';
export type PadState = 'empty' | 'loaded' | 'playing' | 'queued';
export type LightOutput = Pick<MIDIOutput, 'id' | 'name' | 'state' | 'send'>;
export interface Led { status: number; note: number; value: number }

/** Only an unambiguous matching port is auto-paired. Never pick a random output. */
export function pairedOutput(input: MidiDevice | undefined, outputs: LightOutput[]): LightOutput | undefined {
  if (!input) return;
  const norm = (name: string) => name.toLowerCase().replace(/\b(input|output|in|out)\b/g, '').replace(/[^a-z0-9]/g, '');
  const exact = outputs.filter(o => o.state === 'connected' && norm(o.name ?? '') === norm(input.name));
  return exact.length === 1 ? exact[0] : undefined;
}
export function clipPadState(state: VJClipLauncherState, deck: VJDeck, row: number, column: number): PadState {
  if (deck === 'B' && !state.crossfaderEnabled) return 'empty';
  const grid = deck === 'A' ? state.clipGrid : state.bankBClipGrid;
  const rows = deck === 'A' ? state.layerStates : state.bankBLayerStates;
  const clip = grid[row]?.[column];
  if (!clip) return 'empty';
  if (state.pendingTriggers.some(p => p.bank === deck && p.columnIndex === column &&
    (p.kind === 'column' ? (!p.layerIndices || p.layerIndices.includes(row)) : p.layerIndex === row))) return 'queued';
  return rows[row]?.activeClip?.id === clip.id ? 'playing' : 'loaded';
}
function color(state: PadState, deck: VJDeck, blink: boolean, generic: boolean): number {
  if (state === 'empty' || (state === 'queued' && !blink)) return 0;
  if (generic) return state === 'loaded' ? 20 : 127;
  if (state === 'queued') return 13;
  return deck === 'A' ? (state === 'playing' ? 21 : 23) : (state === 'playing' ? 45 : 47);
}
function mappingState(path: string, state: VJClipLauncherState): { state: PadState; deck: VJDeck } | null {
  const clip = /^(vj|vj-b):(\d+):trigger:(\d+)$/.exec(path);
  const deck = path.startsWith('vj-b:') ? 'B' : 'A';
  if (clip) return { state: clipPadState(state, deck, +clip[2], +clip[3]), deck };
  let active: boolean;
  if (path === 'vj:mode') active = state.isOpen;
  else if (path === 'vj:crossfader:enabled') active = state.crossfaderEnabled;
  else if (path === 'vj:crossfader:cut-a') active = state.crossfaderValue === 0;
  else if (path === 'vj:crossfader:cut-b') active = state.crossfaderValue === 1;
  else {
    const block = /^(vj|vj-b):block:(\d+)$/.exec(path);
    if (!block) return null;
    active = state.blocks[+block[2]]?.id === state.activeBlockId;
  }
  return { state: active ? 'playing' : 'empty', deck };
}
export function feedbackFrame(state: VJClipLauncherState, settings: ControllerLightsSettings,
  profile: ControllerProfile, mappings: MidiMapping[], blink: boolean): Led[] {
  const deck = settings.deck === 'selected' ? state.selectedDeck : settings.deck;
  const leds = new Map<string, Led>();
  for (let row = 0; row < profile.rows; row++) for (let col = 0; col < profile.columns; col++) {
    const note = profile.note(row, col);
    leds.set(`note:${note}`, { status: 0x90 | profile.channel, note,
      value: color(clipPadState(state, deck, row + settings.rowPage * profile.rows, col + settings.columnPage * profile.columns), deck, blink, false) });
  }
  for (const m of mappings) {
    if (m.type !== 'note' || !Number.isInteger(m.number) || m.number < 0 || m.number > 127) continue;
    const pad = mappingState(m.path, state);
    if (!pad) continue;
    // Learned controls take precedence over the built-in grid, like input routing.
    const grid = leds.has(`note:${m.number}`);
    const status = 0x90 | (grid ? profile.channel : Math.max(0, Math.min(15, m.channel)));
    const id = grid ? `note:${m.number}` : `${status}:${m.number}`;
    const value = color(pad.state, pad.deck, blink, profile.id === 'generic' || !grid);
    const previous = leds.get(id);
    if (!previous || grid || value > previous.value) leds.set(id, { status, note: m.number, value });
  }
  return [...leds.values()];
}

/** All updates coalesce into one frame; blinking is driven by caller time. */
export class ControllerLights {
  private output?: LightOutput;
  private profile?: ControllerProfile;
  private sent = new Map<string, Led>();
  private failedKey: string | null = null;
  constructor(private status: (message: string) => void) {}
  render(state: VJClipLauncherState, midi: MidiStoreState, settings: ControllerLightsSettings,
    outputs: LightOutput[], sysex: boolean, now: number) {
    const output = settings.outputId ? outputs.find(o => o.id === settings.outputId && o.state === 'connected')
      : pairedOutput(midi.devices.find(d => d.id === midi.selectedDeviceId), outputs);
    const profile = controllerProfiles[settings.profile === 'auto' ? detectControllerProfile(output?.name ?? '') : settings.profile];
    if (!settings.enabled || !state.isOpen || !state.isLive) { this.clear(); if (settings.enabled) this.status('Ready — open the VJ mixer'); return; }
    if (!output) { this.clear(); this.status('Choose a connected controller output'); return; }
    if (profile.enter.length && !sysex) { this.clear(); this.status('Enable controller lights to allow device setup'); return; }
    const key = `${output.id}:${profile.id}`;
    if (this.failedKey === key) return;
    try {
      if (this.output !== output || this.profile !== profile) {
        this.clear(); this.output = output; this.profile = profile;
        for (const bytes of profile.enter) output.send(bytes);
      }
      const desired = new Map(feedbackFrame(state, settings, profile, midi.mappings, Math.floor(now / 250) % 2 === 0)
        .map(led => [`${led.status}:${led.note}`, led]));
      for (const [key, led] of this.sent) if (!desired.has(key)) output.send([led.status, led.note, 0]);
      for (const [key, led] of desired) if (this.sent.get(key)?.value !== led.value) output.send([led.status, led.note, led.value]);
      this.sent = desired;
      this.status(`${profile.label} · ${output.name ?? 'MIDI output'}`);
    } catch (error) {
      this.clear(); this.failedKey = key;
      this.status(`Controller lights stopped: ${error instanceof Error ? error.message : 'output unavailable'}. Disable and enable to retry.`);
    }
  }
  clear() {
    if (this.output) {
      try {
        for (const led of this.sent.values()) this.output.send([led.status, led.note, 0]);
        for (const bytes of this.profile?.leave ?? []) this.output.send(bytes);
      } catch { /* Hot-unplug cannot accept a final clear. */ }
    }
    this.output = undefined; this.profile = undefined; this.sent.clear(); this.failedKey = null;
  }
}
