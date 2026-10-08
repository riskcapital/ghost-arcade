import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInteractiveQuality, interactiveFrameDelta } from './interactiveQuality';
import { defaultInteractive, inside, InteractiveWorld, type InteractiveScene } from './interactive';
import { makeEffect, effectScene } from './interactiveEffects';
import { MatterPreview } from './matterPreview';

afterEach(() => vi.unstubAllGlobals());

function canvasHarness() {
  const created: { width: number; height: number; getContext: () => CanvasRenderingContext2D }[] = [];
  const imageAllocations = vi.fn((w: number, h: number) => ({
    width: w,
    height: h,
    data: new Uint8ClampedArray(w * h * 4),
  }));
  const uploads = vi.fn();
  function context() {
    return new Proxy(
      { globalAlpha: 1, createImageData: imageAllocations, putImageData: uploads },
      {
        get(target, key) {
          if (key in target) return target[key as keyof typeof target];
          if (key === 'createRadialGradient' || key === 'createLinearGradient') return () => ({ addColorStop() {} });
          return () => {};
        },
      },
    ) as unknown as CanvasRenderingContext2D;
  }
  vi.stubGlobal('document', {
    createElement: () => {
      const ctx = context(),
        canvas = { width: 0, height: 0, getContext: () => ctx };
      created.push(canvas);
      return canvas;
    },
  });
  return { context: context(), created, imageAllocations, uploads };
}

const sceneFor = (kind: Parameters<typeof makeEffect>[0]) => {
  const effect = makeEffect(kind);
  const scene: InteractiveScene = { ...defaultInteractive(), surfaces: [], effects: [effect] };
  return { effect, scene };
};

describe('mobile interactive quality budgets', () => {
  it('shares finite device-aware limits across all eight layers', () => {
    for (const hints of [{ hardwareConcurrency: 4 }, {}, { hardwareConcurrency: 8, deviceMemory: 8 }]) {
      const one = createInteractiveQuality(1, hints);
      for (let count = 1; count <= 8; count++) {
        const quality = createInteractiveQuality(count, hints);
        expect(quality.particleLimit * count).toBeLessThanOrEqual(one.particleLimit);
        expect(quality.pointLimit * count).toBeLessThanOrEqual(one.pointLimit);
        expect(quality.collisionChecks * count).toBeLessThanOrEqual(one.collisionChecks);
        expect(quality.fieldWidth * quality.fieldHeight * count).toBeLessThanOrEqual(112 * 63 * 1.25);
        expect(Number.isInteger(quality.fieldHeight)).toBe(true);
        expect(quality.canvasWidth * quality.canvasHeight * count).toBeLessThanOrEqual(8 * 256 * 144);
      }
    }
    expect(createInteractiveQuality(8, { hardwareConcurrency: 4 }).tier).toBe('economy');
    expect(createInteractiveQuality(8, { hardwareConcurrency: 8 }).tier).toBe('balanced');
    expect(createInteractiveQuality(8, { hardwareConcurrency: 8, deviceMemory: 8 }).tier).toBe('high');
  });

  it('uses the same finite bounded delta for all simulation paths', () => {
    for (const value of [NaN, Infinity, -Infinity, -1, 0]) expect(interactiveFrameDelta(value)).toBe(0);
    expect(interactiveFrameDelta(1 / 30)).toBe(1 / 30);
    expect(interactiveFrameDelta(120)).toBe(0.05);
    const { scene } = sceneFor('balls'),
      world = new InteractiveWorld(createInteractiveQuality(1, {}));
    world.update(scene, 120, []);
    expect(world.clock).toBe(0.05);
    world.update(scene, 1 / 30, []);
    expect(world.clock).toBeCloseTo(0.05 + 1 / 30);
    world.update(scene, NaN, []);
    expect(world.clock).toBeCloseTo(0.05 + 1 / 30);
  });

  it.each(['light', 'balls', 'cloud'] as const)('%s allocates no fluid fields or canvases', (kind) => {
    const canvas = canvasHarness(),
      { scene, effect } = sceneFor(kind),
      world = new MatterPreview();
    world.effect = effect;
    const layer = effectScene(scene, effect);
    for (let i = 0; i < 20; i++) world.update(layer, 0.05, []);
    world.draw(canvas.context, layer, 640, 360);
    expect(world.diagnostics().bufferBytes).toBe(0);
    expect(canvas.created).toHaveLength(0);
    if (kind === 'light') expect(world.diagnostics().particles).toBe(0);
  });

  it.each(['liquid', 'fire', 'smoke'] as const)('%s reuses pixel storage and releases it on disable', (kind) => {
    const canvas = canvasHarness(),
      { scene, effect } = sceneFor(kind),
      world = new MatterPreview();
    world.effect = effect;
    const layer = effectScene(scene, effect);
    for (let i = 0; i < 20; i++) {
      world.update(layer, 0.05, []);
      world.draw(canvas.context, layer, 640, 360);
    }
    expect(canvas.created).toHaveLength(1);
    expect(canvas.imageAllocations).toHaveBeenCalledTimes(1);
    expect(world.diagnostics().heatCanvas).toBe(kind !== 'liquid');
    expect(world.diagnostics().liquidCanvas).toBe(kind === 'liquid');
    const uploads = canvas.uploads.mock.calls.length;
    for (let i = 0; i < 20; i++) {
      world.update(layer, 0, []);
      world.draw(canvas.context, layer, 640, 360);
    }
    expect(canvas.uploads).toHaveBeenCalledTimes(uploads);
    effect.enabled = false;
    world.update(layer, 0.05, []);
    expect(world.diagnostics().bufferBytes).toBe(0);
    expect(world.diagnostics().particles).toBe(0);
    expect(canvas.created[0].width).toBe(0);
  });

  it('does not spawn or consume a queued burst while paused', () => {
    const { scene, effect } = sceneFor('balls'),
      world = new MatterPreview();
    effect.emission = 'burst';
    effect.burst++;
    world.effect = effect;
    const layer = effectScene(scene, effect);
    for (let i = 0; i < 50; i++) world.update(layer, 0, []);
    expect(world.diagnostics().particles).toBe(0);
    for (let i = 0; i < 6; i++) world.update(layer, 0.05, []);
    expect(world.diagnostics().particles).toBeGreaterThan(0);
    const before = JSON.stringify(world);
    world.update(layer, 0, []);
    expect(JSON.stringify(world)).toBe(before);
  });

  it('preserves a paused fluid field through a layer-budget change', () => {
    const { scene, effect } = sceneFor('fire'),
      world = new MatterPreview();
    world.effect = effect;
    const layer = effectScene(scene, effect);
    for (let i = 0; i < 20; i++) world.update(layer, 0.05, []);
    world.setQuality(createInteractiveQuality(8, {}));
    const { field } = world as unknown as { field: Float32Array };
    expect(field.some((v) => v > 0)).toBe(true);
    const before = field.slice();
    world.update(layer, 0, []);
    expect(field).toEqual(before);
  });

  it('matches polygon coverage for concave blockers at every fluid grid cell', () => {
    const { scene, effect } = sceneFor('liquid'),
      world = new MatterPreview();
    const quality = createInteractiveQuality(4, {});
    world.setQuality(quality);
    world.effect = effect;
    scene.surfaces = [
      {
        id: 'concave',
        name: 'L',
        behavior: 'solid',
        points: [
          { x: 0.1, y: 0.1 },
          { x: 0.8, y: 0.1 },
          { x: 0.8, y: 0.3 },
          { x: 0.3, y: 0.3 },
          { x: 0.3, y: 0.9 },
          { x: 0.1, y: 0.9 },
        ],
      },
    ];
    world.update(effectScene(scene, effect), 0.05, []);
    const { mask } = world as unknown as { mask: Uint8Array };
    for (let y = 0; y < quality.fieldHeight; y++)
      for (let x = 0; x < quality.fieldWidth; x++) {
        expect(!!mask[y * quality.fieldWidth + x]).toBe(
          inside({ x: (x + 0.5) / quality.fieldWidth, y: (y + 0.5) / quality.fieldHeight }, scene.surfaces[0].points),
        );
      }
  });

  it('retains maximum authored geometry while bounding exact collision work', () => {
    const { scene, effect } = sceneFor('liquid'),
      world = new MatterPreview();
    const quality = createInteractiveQuality(8, { hardwareConcurrency: 4 });
    world.setQuality(quality);
    world.effect = effect;
    scene.surfaces = Array.from({ length: 32 }, (_, i) => ({
      id: `solid-${i}`,
      name: 'Solid',
      behavior: 'solid' as const,
      points: Array.from({ length: 64 }, (_, j) => ({
        x: 0.5 + Math.cos((j / 64) * Math.PI * 2) * 0.3,
        y: 0.5 + Math.sin((j / 64) * Math.PI * 2) * 0.3,
      })),
    }));
    const before = structuredClone(scene),
      layer = effectScene(scene, effect);
    world.update(layer, 0.05, []);
    const state = world as unknown as {
      particles: { x: number; y: number; vx: number; vy: number; r: number; age: number; seed: number }[];
    };
    state.particles = Array.from({ length: 700 }, () => ({
      x: 0.5,
      y: 0.5,
      vx: 0,
      vy: 0,
      r: 0.01,
      age: 0.1,
      seed: 0.5,
    }));
    world.update(layer, 0.05, []);
    expect(world.diagnostics().particles).toBeLessThanOrEqual(world.diagnostics().particleLimit);
    expect(world.diagnostics().collisionChecks).toBeGreaterThan(0);
    expect(world.diagnostics().collisionChecks).toBeLessThanOrEqual(quality.collisionChecks);
    expect(scene).toEqual(before);
  });

  it('cleans all eight rendered layers, and resets transient state when effects are re-enabled', () => {
    const canvas = canvasHarness(),
      world = new InteractiveWorld(createInteractiveQuality(1, {}));
    const scene: InteractiveScene = {
      ...defaultInteractive(),
      surfaces: [],
      effects: ['liquid', 'fire', 'smoke', 'balls', 'cloud', 'light', 'garden', 'ribbons'].map((kind) =>
        makeEffect(kind as Parameters<typeof makeEffect>[0]),
      ),
    };
    const before = structuredClone(scene);
    for (let i = 0; i < 40; i++) world.update(scene, 0.05, []);
    world.draw(canvas.context, scene, 640, 360, 0.05);
    const live = world.qualityDiagnostics();
    expect(live.activeWorlds).toBe(8);
    expect(live.canvasCount).toBe(8);
    expect(live.particles).toBeLessThanOrEqual(8 * Math.max(live.particleLimit, live.pointLimit));
    expect(live.bufferBytes).toBeLessThan(200_000);
    expect(scene).toEqual(before);
    scene.effects!.forEach((effect) => {
      effect.enabled = false;
    });
    world.update(scene, 0, []);
    expect(world.qualityDiagnostics()).toMatchObject({ activeWorlds: 0, canvasCount: 0, particles: 0, bufferBytes: 0 });
    expect(canvas.created.every((c) => c.width === 0 && c.height === 0)).toBe(true);
    scene.effects![0].enabled = true;
    world.update(scene, 0, []);
    expect(world.qualityDiagnostics().particles).toBe(0);
    world.dispose();
    expect(world.qualityDiagnostics()).toMatchObject({ activeWorlds: 0, canvasCount: 0, particles: 0, bufferBytes: 0 });
  });

  it('retains simulation state when an enabled effect fades through zero opacity', () => {
    const world = new InteractiveWorld(createInteractiveQuality(1, {})),
      { scene, effect } = sceneFor('balls');
    for (let i = 0; i < 40; i++) world.update(scene, 0.05, []);
    const before = world.qualityDiagnostics();
    expect(before.particles).toBeGreaterThan(0);
    effect.params.opacity = 0;
    world.update(scene, 0, []);
    expect(world.qualityDiagnostics().particles).toBe(before.particles);
    expect(world.qualityDiagnostics().activeWorlds).toBe(1);
    effect.params.opacity = 1;
    world.update(scene, 0, []);
    expect(world.qualityDiagnostics().particles).toBe(before.particles);
  });

  it('keeps authored attractors active even with the full touch input budget', () => {
    const world = new InteractiveWorld(createInteractiveQuality(1, {}));
    const scene: InteractiveScene = {
      ...defaultInteractive(),
      gravity: 0,
      surfaces: Array.from({ length: 9 }, (_, i) => {
        const x = i === 8 ? 0.8 : 0.5;
        return {
          id: `attractor-${i}`,
          name: 'Attractor',
          behavior: 'attractor',
          points: [
            { x: x - 0.02, y: 0.49 },
            { x: x + 0.02, y: 0.49 },
            { x, y: 0.52 },
          ],
        };
      }),
    };
    world.particles = [{ x: 0.5, y: 0.5, vx: 0, vy: 0, life: 5, seed: 0.5 }];
    world.update(
      scene,
      0.05,
      Array.from({ length: 8 }, (_, i) => ({ id: String(i), point: { x: 0.5, y: 0.5 }, strength: 0 })),
    );
    expect(world.particles[0].vx).toBeGreaterThan(0);
  });

  it('reuses an unchanged paused layer canvas without redrawing particles', () => {
    const canvas = canvasHarness(),
      { scene } = sceneFor('balls'),
      world = new InteractiveWorld(createInteractiveQuality(1, {}));
    for (let i = 0; i < 40; i++) world.update(scene, 0.05, []);
    world.draw(canvas.context, scene, 640, 360, 0.05);
    const child = [...(world as unknown as { effectWorlds: Map<string, InteractiveWorld> }).effectWorlds.values()][0];
    const draw = vi.spyOn(child, 'draw');
    for (let i = 0; i < 20; i++) {
      world.update(scene, 0, []);
      world.draw(canvas.context, scene, 640, 360, 0);
    }
    expect(draw).not.toHaveBeenCalled();
    scene.effects![0].params.hue += 10;
    world.update(scene, 0, []);
    world.draw(canvas.context, scene, 640, 360, 0);
    expect(draw).toHaveBeenCalledTimes(1);
  });

  it('batches light shadows into one filtered fill even at maximum geometry', () => {
    const canvas = canvasHarness(),
      { scene, effect } = sceneFor('light'),
      world = new MatterPreview();
    scene.surfaces = Array.from({ length: 32 }, (_, i) => ({
      id: `solid-${i}`,
      name: 'Solid',
      behavior: 'solid',
      points: Array.from({ length: 64 }, (_, j) => ({
        x: 0.5 + Math.cos((j / 64) * Math.PI * 2) * 0.3,
        y: 0.5 + Math.sin((j / 64) * Math.PI * 2) * 0.3,
      })),
    }));
    world.effect = effect;
    let filteredFills = 0;
    canvas.context.fill = (() => {
      if (canvas.context.globalCompositeOperation === 'destination-out') filteredFills++;
    }) as CanvasRenderingContext2D['fill'];
    const layer = effectScene(scene, effect);
    world.update(layer, 0.05, []);
    world.draw(canvas.context, layer, 640, 360);
    expect(filteredFills).toBe(1);
  });
});
