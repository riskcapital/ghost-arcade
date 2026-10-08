import { describe, it, expect } from 'vitest';
import { MatterPreview } from './matterPreview';
import { defaultInteractive } from './interactive';
import { makeEffect, effectScene } from './interactiveEffects';

// Inspect simulation state directly so a bright/stale canvas cannot mask expiry bugs.
const state = (world: MatterPreview) => world as unknown as {
  particles: { x: number; y: number; age: number }[];
  liquidField: Float32Array;
};
describe('portable interactive matter', () => {
  it.each(['balls', 'liquid'] as const)('%s keeps spawning, applies live lifetime, and clears stopped bursts', kind => {
    const effect = makeEffect(kind), world = new MatterPreview();
    Object.assign(effect.params, { lifetime: 1, flow: 1, x: .25, radius: .01 });
    world.effect = effect;
    const scene = { ...defaultInteractive(), surfaces: [], effects: [effect] };
    function advance(seconds: number) {
      for (let i = 0; i < Math.round(seconds / .05); i++) world.update(effectScene(scene, effect), .05, []);
      return state(world).particles;
    }
    let live = advance(4);
    expect(live.length).toBeGreaterThan(5);
    expect(live.every(p => p.age < 1)).toBe(true);
    expect(live.some(p => p.age < .2 && p.y < .2)).toBe(true);
    effect.params.x = .75;
    expect(advance(.5).some(p => p.age < .2 && p.x > .7)).toBe(true);
    effect.params.lifetime = 6;
    expect(advance(3).some(p => p.age > 2)).toBe(true);
    effect.params.lifetime = 1;
    expect(advance(.05).every(p => p.age < 1)).toBe(true);
    effect.params.flow = 0;
    expect(advance(2)).toHaveLength(0);
    expect(state(world).liquidField.every(v => v === 0)).toBe(true);
    expect(advance(2)).toHaveLength(0);
    effect.emission = 'burst'; effect.params.flow = 1;
    expect(advance(1)).toHaveLength(0);
    effect.burst++;
    expect(advance(.25).length).toBeGreaterThan(0);
    expect(advance(2)).toHaveLength(0);
    expect(state(world).liquidField.every(v => v === 0)).toBe(true);
    effect.emission = 'continuous'; effect.params.lifetime = 40;
    const ages: number[] = [];
    for (let i = 0; i < 50; i++) ages.push(Math.min(...advance(1).map(p => p.age)));
    expect(ages.slice(5).every(age => age < 1.5)).toBe(true);
  });
});
