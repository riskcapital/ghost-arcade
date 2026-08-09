import { describe, expect, it } from 'vitest';
import type {
  WLEDController,
  WLEDEffectAutomation,
  WLEDGroup,
  WLEDPatternCategory,
} from '../types';
import {
  WLED_PATTERN_CATALOG,
  WLED_PATTERN_CATEGORIES,
  applyWLEDEffects,
  createWLEDEffect,
} from './effects';

const controller: WLEDController = {
  id: 'controller-a',
  name: 'Stage',
  ipAddr: '127.0.0.1',
  port: 21324,
  ledCount: 24,
  enabled: true,
  ranges: [
    { id: 'left', name: 'Left Strip', start: 0, count: 8 },
    { id: 'center', name: 'Center Strip', start: 8, count: 8 },
    { id: 'right', name: 'Right Strip', start: 16, count: 8 },
  ],
};

function makeSource(count = controller.ledCount): Uint8Array {
  const source = new Uint8Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    source[index * 3] = (index * 47 + 31) % 256;
    source[index * 3 + 1] = (index * 73 + 79) % 256;
    source[index * 3 + 2] = (index * 29 + 151) % 256;
  }
  return source;
}

describe('WLED pattern catalog', () => {
  it('contains the complete unique 48-pattern performance catalog', () => {
    const ids = WLED_PATTERN_CATALOG.map(pattern => pattern.id);
    expect(ids).toHaveLength(48);
    expect(new Set(ids).size).toBe(ids.length);
    expect(WLED_PATTERN_CATEGORIES.map(category => category.id)).toEqual([
      'color',
      'movement',
      'organic',
      'rhythmic',
      'spatial',
      'content',
      'glitch',
    ]);
  });

  it('keeps every category populated with its expected inventory', () => {
    const expected: Record<WLEDPatternCategory, number> = {
      color: 1,
      movement: 8,
      organic: 10,
      rhythmic: 7,
      spatial: 9,
      content: 7,
      glitch: 6,
    };
    for (const category of WLED_PATTERN_CATEGORIES) {
      expect(
        WLED_PATTERN_CATALOG.filter(pattern => pattern.category === category.id)
      ).toHaveLength(expected[category.id]);
    }
  });

  it.each(WLED_PATTERN_CATALOG)('$label renders bounded RGB output', definition => {
    const source = makeSource();
    const output = new Uint8Array(source.length);
    const effect = createWLEDEffect(definition.id);
    effect.active = true;
    effect.colorSource = 'rainbow';
    effect.target = { mode: 'all' };

    expect(() => applyWLEDEffects(
      source,
      output,
      controller,
      [],
      [effect],
      undefined,
      1234,
      128
    )).not.toThrow();
    expect(output).toHaveLength(source.length);
    expect(Array.from(output).every(channel => channel >= 0 && channel <= 255)).toBe(true);
  });
});

describe('WLED effect targeting and automation', () => {
  it('renders custom color layouts from the color effect', () => {
    const source = makeSource();
    const output = new Uint8Array(source.length);
    const effect = createWLEDEffect('solid-color');
    effect.active = true;
    effect.color = '#ff0000';
    effect.secondaryColor = '#00ff00';
    effect.tertiaryColor = '#0000ff';
    effect.params.colorCount = 3;
    effect.params.colorPattern = 2;
    effect.blendMode = 'replace';

    applyWLEDEffects(source, output, controller, [], [effect], undefined, 1000, 120);

    expect(Array.from(output.slice(0, 9))).toEqual([
      255, 0, 0,
      0, 255, 0,
      0, 0, 255,
    ]);
  });

  it('changes only the selected physical controller range', () => {
    const source = makeSource();
    const output = new Uint8Array(source.length);
    const effect = createWLEDEffect('gradient-drift');
    effect.active = true;
    effect.colorSource = 'custom';
    effect.color = '#ff0000';
    effect.secondaryColor = '#0000ff';
    effect.blendMode = 'replace';
    effect.target = { mode: 'range', controllerId: controller.id, rangeId: 'center' };

    applyWLEDEffects(source, output, controller, [], [effect], undefined, 2000, 120);

    expect(Array.from(output.slice(0, 8 * 3))).toEqual(Array.from(source.slice(0, 8 * 3)));
    expect(Array.from(output.slice(8 * 3, 16 * 3))).not.toEqual(Array.from(source.slice(8 * 3, 16 * 3)));
    expect(Array.from(output.slice(16 * 3))).toEqual(Array.from(source.slice(16 * 3)));
  });

  it('resolves a multi-controller group member down to its named range', () => {
    const source = makeSource();
    const output = new Uint8Array(source.length);
    const groups: WLEDGroup[] = [{
      id: 'front-rig',
      name: 'Front Rig',
      members: [
        { controllerId: controller.id, rangeId: 'left' },
        { controllerId: 'controller-b' },
      ],
    }];
    const effect = createWLEDEffect('strobe');
    effect.active = true;
    effect.colorSource = 'custom';
    effect.color = '#ffffff';
    effect.blendMode = 'replace';
    effect.target = { mode: 'group', groupId: 'front-rig' };

    applyWLEDEffects(source, output, controller, groups, [effect], undefined, 0, 120);

    expect(Array.from(output.slice(0, 8 * 3))).not.toEqual(Array.from(source.slice(0, 8 * 3)));
    expect(Array.from(output.slice(8 * 3))).toEqual(Array.from(source.slice(8 * 3)));
  });

  it('selects enabled effects from an automatic beat sequence', () => {
    const source = makeSource();
    const output = new Uint8Array(source.length);
    const first = createWLEDEffect('gradient-drift', 0);
    const second = createWLEDEffect('rgb-split', 1);
    first.colorSource = 'custom';
    first.color = '#00ff00';
    first.secondaryColor = '#ff00ff';
    first.blendMode = 'replace';
    const automation: WLEDEffectAutomation = {
      playing: true,
      mode: 'beat',
      beats: 1,
      seconds: 1,
      order: 'forward',
    };

    applyWLEDEffects(source, output, controller, [], [first, second], automation, 0, 120);
    expect(Array.from(output)).not.toEqual(Array.from(source));
  });
});
