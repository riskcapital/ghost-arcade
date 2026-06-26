import { isStandaloneControllerTarget, type MidiBinding, type MidiEvent, type MidiTarget } from './standaloneMidi';

export interface StandaloneOscBinding {
  address: string;
  target: MidiTarget;
  label: string;
  argIndex: number;
  sourceMin: number;
  sourceMax: number;
  invert: boolean;
  trigger: boolean;
}

export interface StandaloneOscLayoutPreset {
  id: string;
  name: string;
  controller: string;
  description: string;
  port: number;
  bindings: StandaloneOscBinding[];
}

export type StandaloneOscState = {
  enabled: boolean;
  port: number;
  presetId: string;
  bindings: StandaloneOscBinding[];
};

type BindingInit = Pick<StandaloneOscBinding, 'address' | 'target' | 'label'> & Partial<StandaloneOscBinding>;

export const DEFAULT_OSC_PRESET_ID = 'ghost-performance';

function binding(init: BindingInit): StandaloneOscBinding {
  return {
    argIndex: 0,
    sourceMin: 0,
    sourceMax: 1,
    invert: false,
    trigger: false,
    ...init,
  };
}

function snapshotBindings(prefix: string): StandaloneOscBinding[] {
  return Array.from({ length: 16 }, (_, i) => binding({
    address: `${prefix}/${i + 1}`,
    target: `snapshot:${i}` as MidiTarget,
    label: `Snapshot ${i + 1}`,
    trigger: true,
  }));
}

export const OSC_LAYOUT_PRESETS: StandaloneOscLayoutPreset[] = [
  {
    id: DEFAULT_OSC_PRESET_ID,
    name: 'Ghost Performance',
    controller: 'Ghost tablet / OSC mixer',
    description: 'Canonical Ghost Arcade addresses for layers, output, mic, and recording.',
    port: 8000,
    bindings: [
      binding({ address: '/ga/layer/1/opacity', target: 'layer:0:opacity', label: 'L1 opacity' }),
      binding({ address: '/ga/layer/2/opacity', target: 'layer:1:opacity', label: 'L2 opacity' }),
      binding({ address: '/ga/layer/3/opacity', target: 'layer:2:opacity', label: 'L3 opacity' }),
      binding({ address: '/ga/layer/4/opacity', target: 'layer:3:opacity', label: 'L4 opacity' }),
      binding({ address: '/ga/layer/1/enabled', target: 'layer:0:enabled', label: 'L1 toggle', trigger: true }),
      binding({ address: '/ga/layer/2/enabled', target: 'layer:1:enabled', label: 'L2 toggle', trigger: true }),
      binding({ address: '/ga/layer/3/enabled', target: 'layer:2:enabled', label: 'L3 toggle', trigger: true }),
      binding({ address: '/ga/layer/4/enabled', target: 'layer:3:enabled', label: 'L4 toggle', trigger: true }),
      binding({ address: '/ga/layer/1/edge', target: 'layer:0:edge', label: 'L1 edge fade' }),
      binding({ address: '/ga/layer/2/edge', target: 'layer:1:edge', label: 'L2 edge fade' }),
      binding({ address: '/ga/layer/3/edge', target: 'layer:2:edge', label: 'L3 edge fade' }),
      binding({ address: '/ga/layer/4/edge', target: 'layer:3:edge', label: 'L4 edge fade' }),
      binding({ address: '/ga/layer/1/speed', target: 'layer:0:speed', label: 'L1 speed' }),
      binding({ address: '/ga/layer/2/speed', target: 'layer:1:speed', label: 'L2 speed' }),
      binding({ address: '/ga/layer/3/speed', target: 'layer:2:speed', label: 'L3 speed' }),
      binding({ address: '/ga/layer/4/speed', target: 'layer:3:speed', label: 'L4 speed' }),
      binding({ address: '/ga/layer/1/intensity', target: 'layer:0:intensity', label: 'L1 audio intensity' }),
      binding({ address: '/ga/layer/2/intensity', target: 'layer:1:intensity', label: 'L2 audio intensity' }),
      binding({ address: '/ga/layer/3/intensity', target: 'layer:2:intensity', label: 'L3 audio intensity' }),
      binding({ address: '/ga/layer/4/intensity', target: 'layer:3:intensity', label: 'L4 audio intensity' }),
      binding({ address: '/ga/layer/1/mapped', target: 'layer:0:mapped', label: 'L1 mapping', trigger: true }),
      binding({ address: '/ga/layer/2/mapped', target: 'layer:1:mapped', label: 'L2 mapping', trigger: true }),
      binding({ address: '/ga/layer/3/mapped', target: 'layer:2:mapped', label: 'L3 mapping', trigger: true }),
      binding({ address: '/ga/layer/4/mapped', target: 'layer:3:mapped', label: 'L4 mapping', trigger: true }),
      ...snapshotBindings('/ga/snapshot'),
      binding({ address: '/ga/layer/1/corner/tl/x', target: 'layer:0:corner:0:x', label: 'L1 TL X' }),
      binding({ address: '/ga/layer/1/corner/tl/y', target: 'layer:0:corner:0:y', label: 'L1 TL Y' }),
      binding({ address: '/ga/layer/1/corner/tr/x', target: 'layer:0:corner:1:x', label: 'L1 TR X' }),
      binding({ address: '/ga/layer/1/corner/tr/y', target: 'layer:0:corner:1:y', label: 'L1 TR Y' }),
      binding({ address: '/ga/layer/1/corner/br/x', target: 'layer:0:corner:2:x', label: 'L1 BR X' }),
      binding({ address: '/ga/layer/1/corner/br/y', target: 'layer:0:corner:2:y', label: 'L1 BR Y' }),
      binding({ address: '/ga/layer/1/corner/bl/x', target: 'layer:0:corner:3:x', label: 'L1 BL X' }),
      binding({ address: '/ga/layer/1/corner/bl/y', target: 'layer:0:corner:3:y', label: 'L1 BL Y' }),
      binding({ address: '/ga/mic/toggle', target: 'micToggle', label: 'Mic', trigger: true }),
      binding({ address: '/ga/output/clean', target: 'cleanOutput', label: 'Clean output', trigger: true }),
      binding({ address: '/ga/record/toggle', target: 'autopilotToggle', label: 'Record', trigger: true }),
    ],
  },
  {
    id: 'touchosc-mixer',
    name: 'TouchOSC Mixer',
    controller: 'TouchOSC / OSC Pilot-style',
    description: 'Straight fader and button map for common tablet OSC mixer layouts.',
    port: 8000,
    bindings: [
      binding({ address: '/1/fader1', target: 'layer:0:opacity', label: 'L1 opacity' }),
      binding({ address: '/1/fader2', target: 'layer:1:opacity', label: 'L2 opacity' }),
      binding({ address: '/1/fader3', target: 'layer:2:opacity', label: 'L3 opacity' }),
      binding({ address: '/1/fader4', target: 'layer:3:opacity', label: 'L4 opacity' }),
      binding({ address: '/1/rotary1', target: 'layer:0:speed', label: 'L1 speed' }),
      binding({ address: '/1/rotary2', target: 'layer:1:speed', label: 'L2 speed' }),
      binding({ address: '/1/rotary3', target: 'layer:2:speed', label: 'L3 speed' }),
      binding({ address: '/1/rotary4', target: 'layer:3:speed', label: 'L4 speed' }),
      binding({ address: '/1/rotary5', target: 'layer:0:intensity', label: 'L1 audio intensity' }),
      binding({ address: '/1/rotary6', target: 'layer:1:intensity', label: 'L2 audio intensity' }),
      binding({ address: '/1/rotary7', target: 'layer:2:intensity', label: 'L3 audio intensity' }),
      binding({ address: '/1/rotary8', target: 'layer:3:intensity', label: 'L4 audio intensity' }),
      binding({ address: '/1/toggle1', target: 'layer:0:enabled', label: 'L1 toggle', trigger: true }),
      binding({ address: '/1/toggle2', target: 'layer:1:enabled', label: 'L2 toggle', trigger: true }),
      binding({ address: '/1/toggle3', target: 'layer:2:enabled', label: 'L3 toggle', trigger: true }),
      binding({ address: '/1/toggle4', target: 'layer:3:enabled', label: 'L4 toggle', trigger: true }),
      ...snapshotBindings('/1/snapshot'),
      binding({ address: '/1/push1', target: 'micToggle', label: 'Mic', trigger: true }),
      binding({ address: '/1/push2', target: 'cleanOutput', label: 'Clean output', trigger: true }),
      binding({ address: '/1/push3', target: 'autopilotToggle', label: 'Record', trigger: true }),
    ],
  },
  {
    id: 'apc-tablet',
    name: 'APC Tablet',
    controller: 'APC Mini-style OSC surface',
    description: 'Fader row plus arm/solo-style buttons for a compact VJ layer deck.',
    port: 8000,
    bindings: [
      binding({ address: '/apc/fader/1', target: 'layer:0:opacity', label: 'L1 opacity' }),
      binding({ address: '/apc/fader/2', target: 'layer:1:opacity', label: 'L2 opacity' }),
      binding({ address: '/apc/fader/3', target: 'layer:2:opacity', label: 'L3 opacity' }),
      binding({ address: '/apc/fader/4', target: 'layer:3:opacity', label: 'L4 opacity' }),
      binding({ address: '/apc/fader/5', target: 'layer:0:speed', label: 'L1 speed' }),
      binding({ address: '/apc/fader/6', target: 'layer:1:speed', label: 'L2 speed' }),
      binding({ address: '/apc/fader/7', target: 'layer:2:speed', label: 'L3 speed' }),
      binding({ address: '/apc/fader/8', target: 'layer:3:speed', label: 'L4 speed' }),
      binding({ address: '/apc/grid/1/1', target: 'layer:0:enabled', label: 'L1 toggle', trigger: true }),
      binding({ address: '/apc/grid/2/1', target: 'layer:1:enabled', label: 'L2 toggle', trigger: true }),
      binding({ address: '/apc/grid/3/1', target: 'layer:2:enabled', label: 'L3 toggle', trigger: true }),
      binding({ address: '/apc/grid/4/1', target: 'layer:3:enabled', label: 'L4 toggle', trigger: true }),
      ...snapshotBindings('/apc/snapshot'),
      binding({ address: '/apc/scene/1', target: 'micToggle', label: 'Mic', trigger: true }),
      binding({ address: '/apc/scene/2', target: 'cleanOutput', label: 'Clean output', trigger: true }),
      binding({ address: '/apc/scene/3', target: 'autopilotToggle', label: 'Record', trigger: true }),
    ],
  },
  {
    id: 'launchpad-tablet',
    name: 'Launchpad Tablet',
    controller: 'Launchpad-style OSC grid',
    description: 'Pad grid layout for quick layer toggles and performance buttons.',
    port: 8000,
    bindings: [
      binding({ address: '/lp/fader/1', target: 'layer:0:opacity', label: 'L1 opacity' }),
      binding({ address: '/lp/fader/2', target: 'layer:1:opacity', label: 'L2 opacity' }),
      binding({ address: '/lp/fader/3', target: 'layer:2:opacity', label: 'L3 opacity' }),
      binding({ address: '/lp/fader/4', target: 'layer:3:opacity', label: 'L4 opacity' }),
      binding({ address: '/lp/fader/5', target: 'layer:0:speed', label: 'L1 speed' }),
      binding({ address: '/lp/fader/6', target: 'layer:1:speed', label: 'L2 speed' }),
      binding({ address: '/lp/fader/7', target: 'layer:2:speed', label: 'L3 speed' }),
      binding({ address: '/lp/fader/8', target: 'layer:3:speed', label: 'L4 speed' }),
      binding({ address: '/lp/pad/1/1', target: 'layer:0:enabled', label: 'L1 toggle', trigger: true }),
      binding({ address: '/lp/pad/2/1', target: 'layer:1:enabled', label: 'L2 toggle', trigger: true }),
      binding({ address: '/lp/pad/3/1', target: 'layer:2:enabled', label: 'L3 toggle', trigger: true }),
      binding({ address: '/lp/pad/4/1', target: 'layer:3:enabled', label: 'L4 toggle', trigger: true }),
      ...snapshotBindings('/lp/snapshot'),
      binding({ address: '/lp/side/1', target: 'micToggle', label: 'Mic', trigger: true }),
      binding({ address: '/lp/side/2', target: 'cleanOutput', label: 'Clean output', trigger: true }),
      binding({ address: '/lp/side/3', target: 'autopilotToggle', label: 'Record', trigger: true }),
    ],
  },
  {
    id: 'nanokontrol-tablet',
    name: 'nanoKONTROL Tablet',
    controller: 'nanoKONTROL-style OSC mixer',
    description: 'Four-channel fader surface with transport buttons for output and recording.',
    port: 8000,
    bindings: [
      binding({ address: '/nk/slider/1', target: 'layer:0:opacity', label: 'L1 opacity' }),
      binding({ address: '/nk/slider/2', target: 'layer:1:opacity', label: 'L2 opacity' }),
      binding({ address: '/nk/slider/3', target: 'layer:2:opacity', label: 'L3 opacity' }),
      binding({ address: '/nk/slider/4', target: 'layer:3:opacity', label: 'L4 opacity' }),
      binding({ address: '/nk/knob/1', target: 'layer:0:edge', label: 'L1 edge fade' }),
      binding({ address: '/nk/knob/2', target: 'layer:1:edge', label: 'L2 edge fade' }),
      binding({ address: '/nk/knob/3', target: 'layer:2:edge', label: 'L3 edge fade' }),
      binding({ address: '/nk/knob/4', target: 'layer:3:edge', label: 'L4 edge fade' }),
      binding({ address: '/nk/knob/5', target: 'layer:0:speed', label: 'L1 speed' }),
      binding({ address: '/nk/knob/6', target: 'layer:1:speed', label: 'L2 speed' }),
      binding({ address: '/nk/knob/7', target: 'layer:2:speed', label: 'L3 speed' }),
      binding({ address: '/nk/knob/8', target: 'layer:3:speed', label: 'L4 speed' }),
      binding({ address: '/nk/mute/1', target: 'layer:0:enabled', label: 'L1 toggle', trigger: true }),
      binding({ address: '/nk/mute/2', target: 'layer:1:enabled', label: 'L2 toggle', trigger: true }),
      binding({ address: '/nk/mute/3', target: 'layer:2:enabled', label: 'L3 toggle', trigger: true }),
      binding({ address: '/nk/mute/4', target: 'layer:3:enabled', label: 'L4 toggle', trigger: true }),
      ...snapshotBindings('/nk/snapshot'),
      binding({ address: '/nk/transport/rewind', target: 'micToggle', label: 'Mic', trigger: true }),
      binding({ address: '/nk/transport/stop', target: 'cleanOutput', label: 'Clean output', trigger: true }),
      binding({ address: '/nk/transport/record', target: 'autopilotToggle', label: 'Record', trigger: true }),
    ],
  },
];

export function findOscLayoutPreset(id: string | null | undefined): StandaloneOscLayoutPreset {
  return OSC_LAYOUT_PRESETS.find(p => p.id === id) ?? OSC_LAYOUT_PRESETS[0];
}

export function normalizeOscPresetId(id: string | null | undefined): string {
  return findOscLayoutPreset(id).id;
}

export function cloneOscBindings(bindings: StandaloneOscBinding[]): StandaloneOscBinding[] {
  return bindings.map(b => ({ ...b }));
}

export function defaultOscState(): StandaloneOscState {
  const preset = findOscLayoutPreset(DEFAULT_OSC_PRESET_ID);
  return { enabled: false, port: preset.port, presetId: preset.id, bindings: cloneOscBindings(preset.bindings) };
}

export function isStandaloneControlTarget(value: unknown): value is MidiTarget {
  return isStandaloneControllerTarget(value);
}

export function normalizeOscBindings(value: unknown, fallbackPresetId = DEFAULT_OSC_PRESET_ID): StandaloneOscBinding[] {
  if (!Array.isArray(value)) return cloneOscBindings(findOscLayoutPreset(fallbackPresetId).bindings);
  const normalized = value
    .filter((b: any) => b && typeof b.address === 'string' && b.address.startsWith('/') && isStandaloneControlTarget(b.target))
    .map((b: any) => binding({
      address: b.address.trim(),
      target: b.target,
      label: typeof b.label === 'string' && b.label.trim() ? b.label.trim() : b.target,
      argIndex: Number.isFinite(b.argIndex) ? Math.max(0, Math.floor(b.argIndex)) : 0,
      sourceMin: Number.isFinite(b.sourceMin) ? b.sourceMin : 0,
      sourceMax: Number.isFinite(b.sourceMax) && b.sourceMax !== b.sourceMin ? b.sourceMax : 1,
      invert: !!b.invert,
      trigger: !!b.trigger,
    }));
  return normalized.length ? normalized : cloneOscBindings(findOscLayoutPreset(fallbackPresetId).bindings);
}

export function standaloneOscLayoutText(bindings: StandaloneOscBinding[], port = 8000): string {
  const lines = [`Ghost Arcade OSC - UDP ${port}`];
  for (const b of bindings) {
    lines.push(`${b.address} -> ${b.label}${b.trigger ? ' [trigger]' : ''}`);
  }
  return lines.join('\n');
}

function oscArgToNumber(raw: unknown): number {
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'boolean') return raw ? 1 : 0;
  if (typeof raw === 'string' && raw.trim() !== '') return Number(raw);
  return NaN;
}

export function routeStandaloneOscMessage(
  bindings: StandaloneOscBinding[],
  address: string,
  args: unknown[],
  onEvent: (target: MidiTarget, event: MidiEvent) => void,
): number {
  let routed = 0;
  for (const b of bindings) {
    if (b.address !== address) continue;
    const raw = oscArgToNumber(args[b.argIndex]);
    if (!Number.isFinite(raw)) continue;
    const span = b.sourceMax - b.sourceMin || 1;
    let value = Math.max(0, Math.min(1, (raw - b.sourceMin) / span));
    if (b.invert) value = 1 - value;
    const midiBinding: MidiBinding = { kind: b.trigger ? 'note' : 'cc', channel: 0, num: 0 };
    onEvent(b.target, {
      binding: midiBinding,
      value,
      isTrigger: b.trigger && value > 0,
    });
    routed++;
  }
  return routed;
}
