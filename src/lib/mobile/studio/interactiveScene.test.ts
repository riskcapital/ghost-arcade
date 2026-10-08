import { describe, it, expect, vi } from 'vitest';
import { defaultInteractive, sanitizeStoredInteractive, validateScene, type InteractiveScene } from './interactive';
import {
  EFFECT_NAME_LIMIT,
  advanceInteractiveAuto,
  applyInteractiveOverrides,
  effectLabels,
  effectName,
  interactiveEditSignature,
  makeEffect,
} from './interactiveEffects';
import { discoverKeyframeableParams } from '../../keyframes/paramDiscovery';
import type { Layer } from '../../types';

const stack = (...kinds: Parameters<typeof makeEffect>[0][]): InteractiveScene => ({
  ...defaultInteractive(),
  effects: kinds.map((kind) => makeEffect(kind)),
});

describe('scene validation keeps only what the scene model knows', () => {
  it('drops unknown keys, extra surface and point data, however large', () => {
    const raw: any = stack('fire');
    raw.junk = 'x'.repeat(1_000_000);
    raw.surfaces[0].payload = 'y'.repeat(1000);
    raw.surfaces[0].points[0].z = 7;
    raw.effects[0].secret = { nested: true };
    raw.matter = { lightX: 0.3, bogus: 1 };
    const scene = validateScene(raw);
    const json = JSON.stringify(scene);
    expect(json.length).toBeLessThan(6000);
    expect(json).not.toContain('junk');
    expect(json).not.toContain('payload');
    expect(json).not.toContain('secret');
    expect(json).not.toContain('bogus');
    expect(Object.keys(scene.surfaces[0].points[0])).toEqual(['x', 'y']);
    expect(scene.matter?.lightX).toBe(0.3);
  });

  it('rejects absurd ids and caps names', () => {
    const longId: any = stack();
    longId.surfaces[0].id = 'i'.repeat(5005);
    expect(() => validateScene(longId)).toThrow('Invalid surface geometry.');
    const emptyId: any = stack();
    emptyId.surfaces[0].id = '';
    expect(() => validateScene(emptyId)).toThrow('Invalid surface geometry.');
    const longName: any = stack();
    longName.surfaces[0].name = 'n'.repeat(5000);
    expect(validateScene(longName).surfaces[0].name).toHaveLength(100);
  });

  it('rejects null surfaces and points instead of throwing a TypeError', () => {
    const nullSurface: any = stack();
    nullSurface.surfaces[0] = null;
    expect(() => validateScene(nullSurface)).toThrow('Invalid surface geometry.');
    const nullPoint: any = stack();
    nullPoint.surfaces[0].points[1] = null;
    expect(() => validateScene(nullPoint)).toThrow('Invalid surface geometry.');
  });

  it('is stable: validating a validated scene changes nothing, and shares nothing', () => {
    const raw = stack('liquid', 'light');
    const once = validateScene(raw);
    expect(validateScene(once)).toEqual(once);
    once.surfaces[0].points[0].x = 0.99;
    once.effects![0].params.hue = 1;
    expect(raw.surfaces[0].points[0].x).not.toBe(0.99);
    expect(raw.effects![0].params.hue).not.toBe(1);
  });
});

describe('scenes coming back from storage', () => {
  it('resets a scene that no longer validates and says so once', () => {
    const onReset = vi.fn();
    const safe = sanitizeStoredInteractive(
      { effectType: 'performer-world', interactiveScene: { schema: 'ghost-interactive', version: 2 }, interactiveInputs: [null] },
      onReset,
    );
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(safe.interactiveScene).toMatchObject({ name: 'Unreadable scene', surfaces: [], effects: [] });
    expect(safe.interactiveInputs).toEqual([]);
    expect((safe as any).effectType).toBe('performer-world');
  });

  it('never restores touches, and keeps a valid scene and phone owner', () => {
    const scene = stack('garden');
    const safe = sanitizeStoredInteractive({
      interactiveScene: { ...scene, junk: 1 },
      interactiveInputs: [{ id: 't', point: { x: 0.5, y: 0.5 }, strength: 1 }],
      interactivePaused: 'yes',
      interactiveRemote: '10.0.0.7:a',
    });
    expect(safe.interactiveScene).toEqual(validateScene(scene));
    expect(safe.interactiveInputs).toEqual([]);
    expect(safe.interactivePaused).toBe(false);
    expect(safe.interactiveRemote).toBe('10.0.0.7:a');
    expect(sanitizeStoredInteractive({ interactiveScene: scene, interactiveRemote: { a: 1 } }).interactiveRemote).toBeUndefined();
  });

  it('leaves sources without a scene alone', () => {
    const plain = { effectType: 'fluid' };
    expect(sanitizeStoredInteractive(plain)).toBe(plain);
    expect(sanitizeStoredInteractive(undefined)).toBeUndefined();
  });
});

describe('effect names and timeline groups', () => {
  it('validates an optional name to at most 40 tidy characters', () => {
    expect(effectName(undefined, 'fire')).toBe('Fire');
    expect(effectName('   ', 'fire')).toBe('Fire');
    expect(effectName('  Left\n torch \u0007 ', 'fire')).toBe('Left torch');
    expect(effectName('n'.repeat(200), 'fire')).toHaveLength(EFFECT_NAME_LIMIT);
    const scene: any = stack('fire');
    scene.effects[0].name = 'x'.repeat(90);
    expect(validateScene(scene).effects![0].name).toHaveLength(EFFECT_NAME_LIMIT);
    delete scene.effects[0].name;
    expect(validateScene(scene).effects![0].name).toBe('Fire');
  });

  it('numbers effects that share a label and keeps unique names as they are', () => {
    const scene = stack('fire', 'fire', 'liquid', 'fire');
    scene.effects![3].name = 'Fire 1'; // a real name that a generated one must not collide with
    const labels = effectLabels(scene.effects!);
    expect(scene.effects!.map((e) => labels.get(e.id))).toEqual(['Fire 2', 'Fire 3', 'Liquid', 'Fire 1']);
    expect(new Set(labels.values()).size).toBe(4);
    scene.effects![1].name = 'Right torch';
    expect(scene.effects!.map((e) => effectLabels(scene.effects!).get(e.id))).toEqual(['Fire', 'Right torch', 'Liquid', 'Fire 1']);
  });

  it('gives two effects of one style their own keyframe timeline group', () => {
    const scene = stack('architecture', 'architecture');
    const layer = { source: { effectSource: { interactiveScene: scene } } } as unknown as Layer;
    const groupsOf = () => [...new Set(discoverKeyframeableParams(layer).map((p) => p.group))].filter((group) => group?.startsWith('Interactive'));
    expect(groupsOf()).toEqual(['Interactive · Living Architecture 1', 'Interactive · Living Architecture 2']);
    scene.effects![0].name = 'Floor';
    expect(groupsOf()).toEqual(['Interactive · Floor', 'Interactive · Living Architecture']);
  });
});

describe('telling an edit from Auto playback', () => {
  const auto = { phase: 0, mode: 'pingpong' as const, speedHz: 0.5, min: 0, max: 3, playing: true };

  it('keeps the same signature while Auto advances, and changes it on any edit', () => {
    const scene = stack('light', 'fire');
    scene.effects![0].paramAuto = { lightPower: { ...auto } };
    const before = interactiveEditSignature(scene);
    const advanced = advanceInteractiveAuto(scene, 0.4, 0);
    expect(advanced).not.toBe(scene);
    expect(advanced.effects![0].params.lightPower).not.toBe(scene.effects![0].params.lightPower);
    expect(interactiveEditSignature(advanced)).toBe(before);
    const edited = { ...advanced, effects: advanced.effects!.map((e, i) => (i === 1 ? { ...e, params: { ...e.params, heat: 2 } } : e)) };
    expect(interactiveEditSignature(edited)).not.toBe(before);
    expect(interactiveEditSignature({ ...advanced, effects: advanced.effects!.slice(0, 1) })).not.toBe(before);
    const moved = structuredClone(advanced);
    moved.surfaces[0].points[0].x += 0.01;
    expect(interactiveEditSignature(moved)).not.toBe(before);
  });

  it('survives scenes whose effect list is damaged', () => {
    const broken = { ...defaultInteractive(), effects: 5 } as unknown as InteractiveScene;
    expect(advanceInteractiveAuto(broken, 0.1, 0)).toBe(broken);
    expect(applyInteractiveOverrides(broken, { 'interactive:x:opacity': 0.5 })).toBe(broken);
    const holes = { ...defaultInteractive(), effects: [null, makeEffect('fire')] } as unknown as InteractiveScene;
    expect(() => advanceInteractiveAuto(holes, 0.1, 0)).not.toThrow();
    expect(() => applyInteractiveOverrides(holes, { 'interactive:x:opacity': 0.5 })).not.toThrow();
  });
});
