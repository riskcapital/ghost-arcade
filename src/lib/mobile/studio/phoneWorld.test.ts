import { describe, expect, it } from 'vitest';
import { ZoneTriggers } from '../../interactive/interactiveRuntime';
import { defaultReliefWorld } from '../../scene3d/worldModel';
import type { TouchTool } from '../../components/studio/interactiveEditorTypes';
import { defaultInteractive, defaultZoneTrigger, validateScene as validateInteractiveScene, type InteractiveScene } from './interactive';
import { sanitizePhoneInputs } from './phoneSessions';
import { DEPTH_CAPTURE_CAPABILITY, PHONE_WORLD_TOOLS, describePhoneClient, keepPhoneWorld, phoneWorldOn, studioCapabilities, withPhoneZoneDefaults } from './phoneWorld';

/** A scene exactly as phone app 1.2 sends it: no trigger, look, input or world. */
const phone12Scene = () => ({
  schema: 'ghost-interactive',
  version: 1,
  name: 'Living room',
  preset: 'architecture',
  energy: 0.6,
  gravity: 0.25,
  hue: 185,
  trails: 0.7,
  surfaces: [
    { id: 'stage', name: 'Stage', behavior: 'solid', points: [{ x: 0.15, y: 0.3 }, { x: 0.4, y: 0.3 }, { x: 0.4, y: 0.7 }, { x: 0.15, y: 0.7 }] },
    { id: 'portal', name: 'Portal', behavior: 'trigger', points: [{ x: 0.6, y: 0.25 }, { x: 0.85, y: 0.25 }, { x: 0.85, y: 0.75 }, { x: 0.6, y: 0.75 }] },
  ],
});
const touch = (x: number, y: number) => ({ id: 't', point: { x, y }, strength: 1, mode: 'attract' as const });

describe('capabilities for a paired phone', () => {
  it('stay version 1 and add the world, its tools, depth capture and the output size', () => {
    const caps = studioCapabilities({ version: 1 }, { width: 3840, height: 1600 });
    // Phone app 1.2 needs exactly these.
    expect(caps).toMatchObject({ type: 'studio_capabilities', version: 1, visualFeeds: true, nativeInteractive: true, scanTransfer: { version: 1 } });
    expect(caps.interactiveWorld).toBe(1);
    expect(caps.worldTools).toEqual(['attract', 'repel', 'vortex', 'throw', 'push', 'pour', 'ignite']);
    expect(caps.depthCapture).toEqual({ version: 1, maxSurfaces: 48, maxSamplesPerSurface: 4000, maxSamplesTotal: 60000, maxOutline: 64, maxBytes: 8000000 });
    expect(caps.output).toEqual({ width: 3840, height: 1600 });
    expect(studioCapabilities(null, { width: NaN, height: 0 }).output).toEqual({ width: 1920, height: 1080 });
    expect(JSON.parse(JSON.stringify(caps)).depthCapture).toEqual(DEPTH_CAPTURE_CAPABILITY);
  });

  it('list every tool the editor and the desktop phone path take', () => {
    const editor: TouchTool[] = [...PHONE_WORLD_TOOLS];
    expect(editor).toHaveLength(7);
    for (const mode of PHONE_WORLD_TOOLS) expect(sanitizePhoneInputs([{ ...touch(0.5, 0.5), mode }])[0].mode).toBe(mode);
  });

  it('describe the phone app for the log, and nothing else', () => {
    expect(describePhoneClient({ app: 'ios', version: '1.2', build: 41 })).toBe('ios 1.2 (build 41)');
    expect(describePhoneClient({ app: 'ios\n<script>', version: '1.2' })).toBe('iosscript 1.2');
    expect(describePhoneClient(undefined)).toBeNull();
    expect(describePhoneClient({ build: 3 })).toBeNull();
    expect(describePhoneClient({ app: 'x'.repeat(500), version: '1' })!.length).toBeLessThan(40);
  });
});

describe('a scene from phone app 1.2', () => {
  it('fires its trigger zone as a new zone does', () => {
    const scene = withPhoneZoneDefaults(validateInteractiveScene(phone12Scene()));
    expect(scene.surfaces[1].trigger).toEqual(defaultZoneTrigger());
    expect(scene.surfaces[0].trigger).toBeUndefined();
    const zones = new ZoneTriggers();
    expect(zones.update(scene, [touch(0.7, 0.5)], 0)).toEqual([{ surfaceId: 'portal', actions: [{ kind: 'burst' }] }]);
    // Held: once. Away and back after the re-arm: again.
    expect(zones.update(scene, [touch(0.7, 0.5)], 0.5)).toEqual([]);
    zones.update(scene, [], 1.2);
    expect(zones.update(scene, [touch(0.7, 0.5)], 1.3)).toHaveLength(1);
  });

  it('keeps a zone trigger the phone did send, and hands back the same scene when nothing is missing', () => {
    const own = { actions: [{ kind: 'world' as const, what: 'ignite' as const }], rearm: 3 };
    const raw = phone12Scene();
    (raw.surfaces[1] as Record<string, unknown>).trigger = own;
    const scene = validateInteractiveScene(raw);
    expect(withPhoneZoneDefaults(scene)).toBe(scene);
    expect(scene.surfaces[1].trigger).toEqual(own);
  });

  it('keeps the world set up on the desktop', () => {
    const desktop: InteractiveScene = { ...defaultInteractive(), world: { ...defaultReliefWorld(), enabled: true } };
    const incoming = validateInteractiveScene(phone12Scene());
    const kept = keepPhoneWorld(incoming, desktop);
    expect(kept.world).toBe(desktop.world);
    expect(kept.surfaces).toBe(incoming.surfaces);
    expect(phoneWorldOn(kept)).toBe(true);
    // Nothing to keep: the phone's scene as it is.
    expect(keepPhoneWorld(incoming, undefined)).toBe(incoming);
    expect(keepPhoneWorld(incoming, defaultInteractive())).toBe(incoming);
  });
});

describe('a scene from a phone with the 3D world', () => {
  it('carries its own world onto a new layer, and can switch it off', () => {
    const world = { ...defaultReliefWorld(), enabled: true };
    const sent = validateInteractiveScene({ ...phone12Scene(), world });
    expect(sent.world?.enabled).toBe(true);
    // A new layer has no scene yet: the phone's world is the layer's.
    expect(phoneWorldOn(keepPhoneWorld(sent, undefined))).toBe(true);
    const desktop: InteractiveScene = { ...defaultInteractive(), world };
    const off = validateInteractiveScene({ ...phone12Scene(), world: { ...world, enabled: false } });
    expect(phoneWorldOn(keepPhoneWorld(off, desktop))).toBe(false);
  });
});
