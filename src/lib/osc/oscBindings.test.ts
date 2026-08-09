import { describe, expect, it } from 'vitest';
import {
  createVjOscTemplateBindings,
  inferOscBindingMode,
  resolveOscBindingValue,
  type OscBindingSpec,
} from './oscBindings';

const continuous: OscBindingSpec = {
  address: '/test',
  argIndex: 0,
  path: 'vj:master:opacity',
  sourceMin: 0,
  sourceMax: 127,
  invert: false,
};

describe('OSC binding values', () => {
  it('normalizes continuous controller values', () => {
    expect(resolveOscBindingValue(continuous, [63.5])).toBeCloseTo(0.5);
  });

  it('does not dispatch an argument-less continuous message', () => {
    expect(resolveOscBindingValue(continuous, [])).toBeNull();
  });

  it('treats an argument-less trigger and OSC Impulse as a press', () => {
    const trigger = { ...continuous, path: 'vj:0:trigger:0', mode: 'trigger' as const };
    expect(resolveOscBindingValue(trigger, [])).toBe(1);
    expect(resolveOscBindingValue(trigger, [Infinity])).toBe(1);
  });

  it('preserves boolean press and release values', () => {
    const trigger = { ...continuous, sourceMax: 1, mode: 'trigger' as const };
    expect(resolveOscBindingValue(trigger, [true])).toBe(1);
    expect(resolveOscBindingValue(trigger, [false])).toBe(0);
  });

  it('infers legacy clip, column, and stop bindings as triggers', () => {
    expect(inferOscBindingMode('vj:0:trigger:3')).toBe('trigger');
    expect(inferOscBindingMode('vj-b:column:2')).toBe('trigger');
    expect(inferOscBindingMode('vj:stopall')).toBe('trigger');
    expect(inferOscBindingMode('vj:master:opacity')).toBe('continuous');
  });
});

describe('VJ OSC template', () => {
  it('builds unique A/B clip routes with friendly one-based addresses', () => {
    const bindings = createVjOscTemplateBindings(2, 3);
    expect(bindings).toHaveLength(2 * 2 * 3 + 2 * 3 + 3);
    expect(new Set(bindings.map(b => b.address)).size).toBe(bindings.length);
    expect(bindings).toContainEqual(expect.objectContaining({
      address: '/ghost/vj/a/layer/1/clip/1',
      path: 'vj:0:trigger:0',
      mode: 'trigger',
    }));
    expect(bindings).toContainEqual(expect.objectContaining({
      address: '/ghost/vj/b/layer/2/clip/3',
      path: 'vj-b:1:trigger:2',
      mode: 'trigger',
    }));
  });

  it('never emits the invalid legacy vj:layer path', () => {
    expect(createVjOscTemplateBindings().some(b => b.path.includes('vj:layer:'))).toBe(false);
  });
});
