import { describe, expect, it } from 'vitest';
import { planDiscard } from './liveEditRevert';
import type { HeldEdit } from './liveEdit';
import type { Layer, Project } from '../types';

const layer = (id: string, opacity: number, extra: Record<string, unknown> = {}) =>
  ({ id, name: id, type: 'media', visible: true, opacity, blendMode: 'normal', source: { id: `s-${id}`, type: 'shader', name: 'Tide', shaderValues: { speed: 2 } }, ...extra } as unknown as Layer);
const held = (target: object, key: string, value: number | boolean, was?: number | boolean): HeldEdit =>
  ({ kind: 'param', id: `${JSON.stringify(target)}|${key}`, target, key, value, ...(was !== undefined ? { was } : {}), t: 3 } as HeldEdit);

const base = () => ({
  layers: [layer('A', 0.4), layer('B', 1)],
  mappingComposition: { enabled: true, effects: [{ id: 'fx1', type: 'glow', enabled: true, opacity: 0.3, params: { amount: 0.8 } }] },
  wledControllers: [{ id: 'c1', name: 'Strip', brightness: 0.2 }],
  wledEffects: [{ id: 'e1', name: 'Chase', active: true, amount: 0.9, speed: 3, params: {} }],
} as unknown as Project);

describe("Discard's plan", () => {
  it('puts each held setting back to its value before the first held change, and nothing else', () => {
    const p = base();
    // B was renamed while A's opacity was held: not a held change, it stays.
    const live = { ...p, layers: [p.layers[0], { ...p.layers[1], name: 'Renamed', opacity: 0.6 }] } as Project;
    const plan = planDiscard(live, [
      held({ scope: 'layer', id: 'A' }, 'layer:opacity', 0.4, 1),
      held({ scope: 'layer', id: 'A' }, 'shader:speed', 2, 5),
    ]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const [a, b] = plan.project.layers as Layer[];
    expect(a.opacity).toBe(1);
    expect((a.source as { shaderValues: Record<string, number> }).shaderValues.speed).toBe(5);
    expect(b).toBe(live.layers[1]);
    expect(b.name).toBe('Renamed');
    // Plain data in, a new project out: the live one is not written.
    expect(live.layers[0].opacity).toBe(0.4);
  });

  it('puts back Stage FX and LED settings', () => {
    const plan = planDiscard(base(), [
      held({ scope: 'stage' }, 'stage:fx:fx1:opacity', 0.3, 0.9),
      held({ scope: 'led' }, 'led:c1:brightness', 0.2, 0.75),
      held({ scope: 'led' }, 'ledfx:e1:speed', 3, 1.5),
    ]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect((plan.project.mappingComposition as { effects: Array<{ opacity: number }> }).effects[0].opacity).toBe(0.9);
    expect(plan.project.wledControllers![0].brightness).toBe(0.75);
    expect(plan.project.wledEffects![0].speed).toBe(1.5);
  });

  it('refuses, naming the change, when a piece is gone, there is no value from before or the setting is not one it can write', () => {
    const gone = held({ scope: 'layer', id: 'Z' }, 'layer:opacity', 0.4, 1);
    expect(planDiscard(base(), [held({ scope: 'layer', id: 'A' }, 'layer:opacity', 0.4, 1), gone])).toEqual({ ok: false, edit: gone });
    const noWas = held({ scope: 'layer', id: 'A' }, 'layer:opacity', 0.4);
    expect(planDiscard(base(), [noWas])).toEqual({ ok: false, edit: noWas });
    const block = held({ scope: 'block', id: 'clip' }, 'shader:speed', 3, 1);
    expect(planDiscard(base(), [block])).toEqual({ ok: false, edit: block });
    const unknownKey = held({ scope: 'layer', id: 'A' }, 'nothing:here', 3, 1);
    expect(planDiscard(base(), [unknownKey])).toEqual({ ok: false, edit: unknownKey });
  });

  it('puts back what a piece showed before a held swap; content held for a row alone changes nothing', () => {
    const previous = { id: 's-old', type: 'video', name: 'rain', src: 'rain.mp4' } as never;
    const swap: HeldEdit = { kind: 'content', id: 'content|layer:A', trackId: null, media: { kind: 'shader', name: 'Prism' } as never, before: null, t: 2, piece: { layerId: 'A', previous } };
    const card: HeldEdit = { kind: 'content', id: 'content|g', trackId: 'g', media: { kind: 'shader', name: 'Card' } as never, before: null, t: 2 };
    const p = base();
    const plan = planDiscard(p, [swap, card]);
    expect(plan).toEqual({ ok: true, project: p, sources: [{ layerId: 'A', source: previous }] });
    const lost = { ...swap, piece: { layerId: 'Z', previous } } as HeldEdit;
    expect(planDiscard(p, [lost])).toEqual({ ok: false, edit: lost });
  });
});
