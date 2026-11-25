/**
 * Desktop side of the phone's 3D Interactive world: what the desktop tells a
 * paired phone it can do, and how a phone's scene is read so that phones from
 * before the 3D world keep working.
 *
 * `studio_capabilities.version` stays 1 (phone app 1.2 requires exactly 1).
 * Every new feature is a flag a phone may ignore.
 */
import { CAPTURE_LIMITS } from '../../scene3d/roomPhone';
import { PICKABLE_SHOW_ACTIONS } from '../../show/showActionLabels';
import { defaultZoneTrigger, type InteractiveScene } from './interactive';

/** Every tool a phone touch may use on the desktop (Throw, Push, Pour and Ignite act on the 3D world). */
export const PHONE_WORLD_TOOLS = ['attract', 'repel', 'vortex', 'throw', 'push', 'pour', 'ignite'] as const;

/** What a room scan sent from a phone may hold. */
export const DEPTH_CAPTURE_CAPABILITY = {
  version: 1,
  maxSurfaces: CAPTURE_LIMITS.surfaces,
  maxSamplesPerSurface: CAPTURE_LIMITS.samplesPerSurface,
  maxSamplesTotal: CAPTURE_LIMITS.samplesTotal,
  maxOutline: CAPTURE_LIMITS.outline,
  maxBytes: 8_000_000,
} as const;

export type StudioCapabilities = {
  type: 'studio_capabilities';
  version: 1;
  visualFeeds: true;
  metricDepth: false;
  nativeInteractive: true;
  scanTransfer: unknown;
  interactiveWorld: 1;
  worldTools: readonly string[];
  depthCapture: typeof DEPTH_CAPTURE_CAPABILITY;
  /** The desktop output's size: the phone edits at this aspect. */
  output: { width: number; height: number };
  /** What a phone's trigger zone may do on the desktop, with the names it needs to pick one. */
  showActions: PhoneShowActions;
  /** 1: a calibration package may come as an object, or in pieces when large (calibrationTransfer.ts). Older desktops take only `json` text up to 8 MB. */
  calibrationTransfer: 1;
};

/** A thing a show action names, by id, with the name the desktop shows. */
export type PhoneShowName = { id: string; name: string };
/**
 * The desktop's show-action menu for a paired phone: the kinds in the
 * desktop picker's order with its labels, and the Looks, presets and
 * Timeline sections there are now. A phone builds the actions itself (the
 * desktop schema, `show/showActions.ts`); the desktop checks every scene.
 */
export type PhoneShowActions = { version: 1; kinds: { kind: string; label: string }[]; looks: PhoneShowName[]; presets: PhoneShowName[]; sections: PhoneShowName[] };
/** At most this many of each list go to the phone. */
export const PHONE_SHOW_NAMES_MAX = 200;

/** The menu from the desktop's lists: names trimmed, empty ids left out, each list capped. */
export function phoneShowActions(lists: { looks: readonly { id: string; name?: string }[]; presets: readonly { id: string; name?: string }[]; sections: readonly { id: string; name?: string }[] }): PhoneShowActions {
  const names = (list: readonly { id: string; name?: string }[], fallback: string): PhoneShowName[] =>
    list
      .filter((x) => typeof x?.id === 'string' && x.id.length > 0 && x.id.length <= 128)
      .slice(0, PHONE_SHOW_NAMES_MAX)
      .map((x, i) => ({ id: x.id, name: (typeof x.name === 'string' && x.name.trim() ? x.name.trim() : `${fallback} ${i + 1}`).slice(0, 60) }));
  return {
    version: 1,
    kinds: PICKABLE_SHOW_ACTIONS.map((k) => ({ kind: k.kind, label: k.label })),
    looks: names(lists.looks, 'Look'),
    presets: names(lists.presets, 'Preset'),
    sections: names(lists.sections, 'Section'),
  };
}

const size = (v: number, fallback: number) => (Number.isFinite(v) && v >= 16 && v <= 32768 ? Math.round(v) : fallback);

export function studioCapabilities(scanTransfer: unknown, output: { width: number; height: number }, showActions: PhoneShowActions = phoneShowActions({ looks: [], presets: [], sections: [] })): StudioCapabilities {
  return {
    type: 'studio_capabilities',
    version: 1,
    visualFeeds: true,
    metricDepth: false,
    nativeInteractive: true,
    scanTransfer,
    interactiveWorld: 1,
    worldTools: PHONE_WORLD_TOOLS,
    depthCapture: DEPTH_CAPTURE_CAPABILITY,
    output: { width: size(output.width, 1920), height: size(output.height, 1080) },
    showActions,
    calibrationTransfer: 1,
  };
}

/** The phone app a capabilities request names (`client: { app, version, build }`), for the log only. */
export function describePhoneClient(raw: unknown): string | null {
  const c = raw as { app?: unknown; version?: unknown; build?: unknown } | null;
  if (!c || typeof c !== 'object') return null;
  const part = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v).replace(/[^\w.+-]/g, '').slice(0, 24) : '');
  const app = part(c.app), version = part(c.version), build = part(c.build);
  if (!app && !version) return null;
  return `${app || 'phone'} ${version || '?'}${build ? ` (build ${build})` : ''}`;
}

/**
 * A phone's scene as the desktop plays it. Phone app 1.2 has trigger zones
 * without a `trigger`: they fire as a new zone does (a burst). Returns the
 * same scene when nothing needs adding.
 */
export function withPhoneZoneDefaults(scene: InteractiveScene): InteractiveScene {
  if (!scene.surfaces.some((s) => s.behavior === 'trigger' && !s.trigger)) return scene;
  return { ...scene, surfaces: scene.surfaces.map((s) => (s.behavior === 'trigger' && !s.trigger ? { ...s, trigger: defaultZoneTrigger() } : s)) };
}

/**
 * The scene to write to a phone's layer. A phone from before the 3D world
 * sends no `world`: the world set up on the desktop stays. A phone with the
 * world always sends it, `enabled: false` to switch it off.
 */
export function keepPhoneWorld(incoming: InteractiveScene, current: InteractiveScene | undefined): InteractiveScene {
  if (incoming.world || !current?.world) return incoming;
  return { ...incoming, world: current.world };
}

/** True when the scene plays a 3D world. */
export const phoneWorldOn = (scene: InteractiveScene | undefined): boolean => !!scene?.world?.enabled;
