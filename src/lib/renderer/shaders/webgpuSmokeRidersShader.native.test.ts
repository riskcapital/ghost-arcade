import { describe, expect, it } from 'vitest';
import {
  SMOKE_RIDERS_NATIVE_GRAPH_SHADER_IDS,
  buildSmokeRidersNativeComputeGraph,
  buildSmokeRidersNativePrecompileCommands,
  resolveSmokeRidersParams,
} from './webgpuSmokeRidersShader';

if (typeof (globalThis as any).btoa !== 'function') {
  (globalThis as any).btoa = (value: string) =>
    (globalThis as any).Buffer.from(value, 'binary').toString('base64');
}

type Pass = { name: string; shader_id: string; entry: string; dispatch: [number, number, number]; bindings: Array<{ binding: number; resource: string; kind: string }> };

function buildGraph(overrides: Record<string, any> = {}, options: Record<string, any> = {}) {
  return buildSmokeRidersNativeComputeGraph({
    sourceId: 'gpu:layer-a:smoke-riders',
    params: {
      quality: 'performance',
      style: 'paint',
      riderCount: 128,
      smokeDensity: 3.2,
      vorticity: 5,
      ...overrides,
    },
    width: 640,
    height: 360,
    time: 1,
    frameDelta: 1 / 60,
    frameIndex: 10,
    audioBass: 0.25,
    audioTreble: 0.1,
    reset: true,
    ...options,
  });
}

function passByName(passes: Pass[], name: string): Pass {
  const pass = passes.find((entry) => entry.name === name);
  expect(pass, `missing pass ${name}`).toBeTruthy();
  return pass!;
}

describe('Smoke Riders resolved params', () => {
  it('folds quality tiers into grid, march and rider budgets', () => {
    const perf = resolveSmokeRidersParams({ quality: 'performance', riderCount: 400, marchSteps: 80 });
    const balanced = resolveSmokeRidersParams({ quality: 'balanced', riderCount: 400, marchSteps: 80 });
    const ultra = resolveSmokeRidersParams({ quality: 'ultra', riderCount: 400, marchSteps: 80 });

    expect(perf.gridSize).toBe(32);
    expect(balanced.gridSize).toBe(48);
    expect(ultra.gridSize).toBe(64);
    expect(perf.riderCount).toBeLessThan(balanced.riderCount);
    expect(ultra.riderCount).toBeGreaterThan(balanced.riderCount);
    expect(perf.marchSteps).toBeLessThan(balanced.marchSteps);
    expect(ultra.marchSteps).toBeGreaterThan(balanced.marchSteps);
    // Pressure is the one budget quality does NOT cut: warm-starting made
    // 20 sweeps cheap enough to keep everywhere, and below that the
    // projection visibly fails to close.
    expect(perf.pressureIterations).toBe(balanced.pressureIterations);
    expect(ultra.pressureIterations).toBeGreaterThan(balanced.pressureIterations);
  });

  it('exposes the coupled-rider controls the instrument is built around', () => {
    const p = resolveSmokeRidersParams({
      vorticity: 7,
      flowCoupling: 2,
      riderWeight: 0.4,
      weightSpread: 1,
      riderDensity: 2,
      buoyancy: 1.5,
      gravity: 0.5,
      vortexPull: -0.75,
      surfaceTension: 1.4,
      paintThickness: 0.9,
      roughness: 0.4,
      metalness: 0.9,
      clearCoat: 0.5,
      coatRoughness: 0.2,
      anisotropy: 0.7,
      exposure: 2,
      backgroundMode: 'transparent',
      backgroundOpacity: 0.25,
      audioReactive: false,
    });
    expect(p.vorticity).toBeCloseTo(7, 5);
    expect(p.flowCoupling).toBe(2);
    expect(p.riderWeight).toBe(0.4);
    expect(p.weightSpread).toBe(1);
    expect(p.riderDensity).toBe(2);
    // g_eff = g(1 - rho_f/rho_p): at a density ratio of 2 a rider feels
    // half of gravity, and below 1 the sign flips so it rises.
    expect(p.gravityFactor).toBeCloseTo(0.5, 6);
    expect(resolveSmokeRidersParams({ riderDensity: 0.5 }).gravityFactor).toBeCloseTo(-1, 6);
    expect(p.buoyancy).toBe(1.5);
    expect(p.gravity).toBe(0.5);
    // Vortex Pull is SIGNED: negative pushes riders out of the cores and
    // onto the strain filaments between them.
    expect(p.vortexPull).toBe(-0.75);
    expect(p.surfaceTension).toBe(1.4);
    expect(p.paintThickness).toBe(0.9);
    expect(p.roughness).toBe(0.4);
    expect(p.metalness).toBe(0.9);
    expect(p.clearCoat).toBe(0.5);
    expect(p.coatRoughness).toBe(0.2);
    expect(p.anisotropy).toBe(0.7);
    expect(p.exposure).toBe(2);
    expect(p.backgroundMode).toBe(0);
    expect(p.backgroundOpacity).toBe(0.25);
    // Audio off means no bass drive leaks into the fluid.
    expect(p.bass).toBe(0);
  });

  it('defaults to AgX and keeps ACES and Linear selectable', () => {
    expect(resolveSmokeRidersParams({}).tonemap).toBe(0);
    expect(resolveSmokeRidersParams({ tonemap: 'agx' }).tonemap).toBe(0);
    expect(resolveSmokeRidersParams({ tonemap: 'aces' }).tonemap).toBe(1);
    expect(resolveSmokeRidersParams({ tonemap: 'linear' }).tonemap).toBe(2);
  });

  it('never drops the pressure solve below the warm-start floor of 20', () => {
    for (const quality of ['performance', 'balanced', 'ultra']) {
      const p = resolveSmokeRidersParams({ quality });
      expect(p.pressureIterations).toBeGreaterThanOrEqual(20);
      expect(p.pressureWarm).toBeGreaterThan(0);
      expect(p.pressureWarm).toBeLessThan(1);
    }
  });

  it('runs MacCormack advection by default but never on the performance tier', () => {
    expect(resolveSmokeRidersParams({ quality: 'balanced' }).macCormack).toBe(true);
    expect(resolveSmokeRidersParams({ quality: 'ultra' }).macCormack).toBe(true);
    expect(resolveSmokeRidersParams({ quality: 'performance' }).macCormack).toBe(false);
    expect(
      resolveSmokeRidersParams({ quality: 'balanced', advection: 'semi-lagrangian' }).macCormack,
    ).toBe(false);
  });

  it('drives the fluid harder on bass when audio reactivity is on', () => {
    const quiet = resolveSmokeRidersParams({ audioReactive: true }, { bass: 0, treble: 0 });
    const loud = resolveSmokeRidersParams({ audioReactive: true }, { bass: 0.8, treble: 0.5 });
    expect(loud.bass).toBeGreaterThan(quiet.bass);
    expect(loud.vorticity).toBeGreaterThan(quiet.vorticity);
    expect(loud.splatStrength).toBeGreaterThan(quiet.splatStrength);
  });
});

describe('Smoke Riders native graph', () => {
  it('publishes precompile commands for every new smoke-riders shader', () => {
    const commands = buildSmokeRidersNativePrecompileCommands();
    const ids = commands.map((command) => command.shader_id);
    expect(ids).toEqual([
      'smoke-riders/vorticity',
      'smoke-riders/pressure',
      'smoke-riders/advect',
      'smoke-riders/surface',
      'smoke-riders/riders',
      'smoke-riders/tiles',
      'smoke-riders/shadowvol',
      'smoke-riders/render',
    ]);
    for (const command of commands) {
      expect(command.type).toBe('precompile_shader');
      expect(command.source.length).toBeGreaterThan(200);
    }
    // The render shader must expose BOTH entry points — the core looks up
    // vs_main and fs_main separately when it builds the render plan.
    const render = commands.find((command) => command.shader_id === 'smoke-riders/render')!;
    expect(render.source).toContain('fn vs_main');
    expect(render.source).toContain('fn fs_main');
    expect(render.stage).toBe('render');

    // The declared graph shader set = reused fluid chain + new passes,
    // and must NOT contain the retired standalone render passes.
    expect(SMOKE_RIDERS_NATIVE_GRAPH_SHADER_IDS).toContain('3d-smoke/advect-velocity');
    expect(SMOKE_RIDERS_NATIVE_GRAPH_SHADER_IDS).not.toContain('3d-smoke/render');
    expect(SMOKE_RIDERS_NATIVE_GRAPH_SHADER_IDS).not.toContain('volumetric-spheres/render');
    expect(SMOKE_RIDERS_NATIVE_GRAPH_SHADER_IDS).not.toContain('volumetric-spheres/sim');
  });

  it('runs vorticity confinement between advection and the pressure solve', () => {
    const graph = buildGraph();
    const passes = graph.config.passes as Pass[];
    const names = passes.map((pass) => pass.name);
    const advect = names.indexOf('smoke-riders-advect-velocity');
    const vorticity = names.indexOf('smoke-riders-vorticity');
    const divergence = names.indexOf('smoke-riders-divergence');
    expect(advect).toBeGreaterThanOrEqual(0);
    expect(vorticity).toBeGreaterThan(advect);
    expect(divergence).toBeGreaterThan(vorticity);

    const pass = passByName(passes, 'smoke-riders-vorticity');
    expect(pass.shader_id).toBe('smoke-riders/vorticity');
    expect(pass.entry).toBe('cs_vorticity');
    // Reads one velocity buffer and writes the other. No |curl| output:
    // nothing consumes it since the riders stopped climbing its gradient.
    const velIn = pass.bindings.find((b) => b.binding === 1)!;
    const velOut = pass.bindings.find((b) => b.binding === 2)!;
    expect(velIn.resource).toMatch(/velocity-[ab]$/);
    expect(velOut.resource).toMatch(/velocity-[ab]$/);
    expect(velIn.resource).not.toBe(velOut.resource);
    expect(velIn.kind).toBe('read-only-storage');
    expect(velOut.kind).toBe('storage');
    expect(pass.bindings).toHaveLength(3);
    expect(graph.config.buffers.some((b) => b.id.endsWith(':curl'))).toBe(false);
  });

  it('injects surface tension before the projection so it comes out divergence-free', () => {
    const graph = buildGraph({ quality: 'balanced' });
    const passes = graph.config.passes as Pass[];
    const names = passes.map((pass) => pass.name);
    expect(names.indexOf('smoke-riders-surface-tension'))
      .toBeGreaterThan(names.indexOf('smoke-riders-vorticity'));
    expect(names.indexOf('smoke-riders-surface-tension'))
      .toBeLessThan(names.indexOf('smoke-riders-divergence'));

    const pass = passByName(passes, 'smoke-riders-surface-tension');
    expect(pass.shader_id).toBe('smoke-riders/surface');
    expect(pass.entry).toBe('cs_surface_tension');
    const bindings = new Map(pass.bindings.map((b) => [b.binding, b]));
    expect(bindings.get(0)!.resource).toMatch(/:surface-uniform$/);
    expect(bindings.get(1)!.resource).toMatch(/density-[ab]$/);
    expect(bindings.get(1)!.kind).toBe('read-only-storage');
    expect(bindings.get(2)!.resource).toMatch(/velocity-[ab]$/);
    expect(bindings.get(3)!.resource).toMatch(/velocity-[ab]$/);
    expect(bindings.get(2)!.resource).not.toBe(bindings.get(3)!.resource);
    expect(bindings.get(3)!.kind).toBe('storage');
  });

  it('warm-starts the pressure field on the buffer the jacobi sweep reads first', () => {
    const graph = buildGraph({ quality: 'balanced' });
    const passes = graph.config.passes as Pass[];
    const names = passes.map((pass) => pass.name);
    const warm = names.indexOf('smoke-riders-pressure-warm');
    expect(warm).toBeGreaterThan(names.indexOf('smoke-riders-divergence'));
    expect(warm).toBeLessThan(names.indexOf('smoke-riders-jacobi-1'));

    const pass = passByName(passes, 'smoke-riders-pressure-warm');
    expect(pass.shader_id).toBe('smoke-riders/pressure');
    expect(pass.entry).toBe('cs_pressure_warm');
    // Scaling the WRONG buffer is a silent no-op, so pin it to the one
    // the first jacobi iteration actually reads.
    const jacobi = passByName(passes, 'smoke-riders-jacobi-1');
    expect(pass.bindings.find((b) => b.binding === 1)!.resource)
      .toBe(jacobi.bindings.find((b) => b.binding === 4)!.resource);
    expect(pass.bindings.find((b) => b.binding === 1)!.kind).toBe('storage');
  });

  it('runs MacCormack as a forward pass plus a limited correction pass', () => {
    const graph = buildGraph({ quality: 'balanced' });
    const passes = graph.config.passes as Pass[];
    const names = passes.map((pass) => pass.name);
    expect(names.indexOf('smoke-riders-advect-velocity-fwd'))
      .toBeLessThan(names.indexOf('smoke-riders-advect-velocity'));
    expect(names.indexOf('smoke-riders-advect-density-fwd'))
      .toBeLessThan(names.indexOf('smoke-riders-advect-density'));

    const fwd = passByName(passes, 'smoke-riders-advect-velocity-fwd');
    const mc = passByName(passes, 'smoke-riders-advect-velocity');
    expect(fwd.shader_id).toBe('smoke-riders/advect');
    expect(fwd.entry).toBe('cs_advect_fwd');
    expect(mc.entry).toBe('cs_advect_mc_vel');
    // Both stages must see the SAME scratch buffer, or the correction
    // reads garbage and the limiter reverts every cell.
    const scratch = fwd.bindings.find((b) => b.binding === 3)!.resource;
    expect(scratch).toMatch(/:advect-tmp$/);
    expect(mc.bindings.find((b) => b.binding === 3)!.resource).toBe(scratch);
    expect(passByName(passes, 'smoke-riders-advect-density').entry).toBe('cs_advect_mc_den');
    expect(passByName(passes, 'smoke-riders-advect-density-fwd').bindings
      .find((b) => b.binding === 3)!.resource).toBe(scratch);

    // The performance tier drops back to the single-pass fluid chain.
    const perf = buildGraph({ quality: 'performance' });
    const perfNames = (perf.config.passes as Pass[]).map((pass) => pass.name);
    expect(perfNames).not.toContain('smoke-riders-advect-velocity-fwd');
    expect(perfNames).not.toContain('smoke-riders-advect-density-fwd');
    expect(passByName(perf.config.passes as Pass[], 'smoke-riders-advect-velocity').shader_id)
      .toBe('3d-smoke/advect-velocity');
  });

  it('binds the fluid velocity, density and curl fields into the rider pass', () => {
    const graph = buildGraph();
    const passes = graph.config.passes as Pass[];
    const riders = passByName(passes, 'smoke-riders-riders');
    expect(riders.shader_id).toBe('smoke-riders/riders');
    expect(riders.entry).toBe('cs_riders');

    const resources = new Map(riders.bindings.map((b) => [b.binding, b]));
    expect(resources.get(1)!.resource).toMatch(/:riders$/);
    expect(resources.get(1)!.kind).toBe('storage');
    // THE coupling: velocity + density + pressure are read-only inputs.
    expect(resources.get(2)!.resource).toMatch(/velocity-[ab]$/);
    expect(resources.get(2)!.kind).toBe('read-only-storage');
    expect(resources.get(3)!.resource).toMatch(/density-[ab]$/);
    expect(resources.get(3)!.kind).toBe('read-only-storage');
    // The signed -c*grad(p) force needs the SOLVED pressure, which is the
    // buffer subtract-gradient read, not the other half of the ping-pong.
    expect(resources.get(4)!.resource).toMatch(/pressure-[ab]$/);
    expect(resources.get(4)!.kind).toBe('read-only-storage');
    expect(resources.get(4)!.resource).toBe(
      passByName(passes, 'smoke-riders-subtract-gradient').bindings
        .find((b) => b.binding === 3)!.resource,
    );

    // The rider pass must run AFTER the projection + density advection so
    // it reads the final divergence-free field, not an intermediate one.
    const names = passes.map((pass) => pass.name);
    expect(names.indexOf('smoke-riders-riders'))
      .toBeGreaterThan(names.indexOf('smoke-riders-advect-density'));
    const velocityUsedByRiders = resources.get(2)!.resource;
    const advectDensity = passByName(passes, 'smoke-riders-advect-density');
    expect(advectDensity.bindings.find((b) => b.binding === 1)!.resource)
      .toBe(velocityUsedByRiders);
  });

  it('bins riders into screen tiles before the render pass', () => {
    const graph = buildGraph();
    const passes = graph.config.passes as Pass[];
    const names = passes.map((pass) => pass.name);
    expect(names.indexOf('smoke-riders-clear-tiles'))
      .toBeGreaterThan(names.indexOf('smoke-riders-riders'));
    expect(names.indexOf('smoke-riders-bin-riders'))
      .toBeGreaterThan(names.indexOf('smoke-riders-clear-tiles'));

    const clear = passByName(passes, 'smoke-riders-clear-tiles');
    const bin = passByName(passes, 'smoke-riders-bin-riders');
    expect(clear.entry).toBe('cs_clear_tiles');
    expect(bin.entry).toBe('cs_bin_riders');
    expect(clear.shader_id).toBe('smoke-riders/tiles');
    expect(bin.shader_id).toBe('smoke-riders/tiles');

    // 640x360 at a 16px tile => 40 x 23 tiles; clear dispatches over tiles,
    // bin dispatches over riders.
    const tileCount = 40 * 23;
    expect(clear.dispatch).toEqual([Math.ceil(tileCount / 64), 1, 1]);
    expect(bin.dispatch).toEqual([Math.ceil(graph.riderCount / 64), 1, 1]);

    const counts = graph.config.buffers.find((b) => b.id.endsWith(':tile-counts'))!;
    const indices = graph.config.buffers.find((b) => b.id.endsWith(':tile-indices'))!;
    expect(counts.byte_length).toBe(tileCount * 4);
    expect(indices.byte_length).toBe(tileCount * 64 * 4);
  });

  it('renders everything in one pass that binds density, riders and tiles', () => {
    const graph = buildGraph();
    expect(graph.config.render_passes).toHaveLength(1);
    const render = graph.config.render_passes[0];
    expect(render).toMatchObject({
      shader_id: 'smoke-riders/render',
      vertex_entry: 'vs_main',
      fragment_entry: 'fs_main',
      source_id: 'gpu:layer-a:smoke-riders',
      target: 'source_frame',
      clear: true,
      vertex_count: 3,
      instance_count: 1,
    });
    const bindings = new Map(render.bindings.map((b) => [b.binding, b]));
    expect(bindings.get(0)!.resource).toMatch(/:render-uniform$/);
    expect(bindings.get(0)!.kind).toBe('uniform');
    expect(bindings.get(1)!.resource).toMatch(/density-[ab]$/);
    expect(bindings.get(2)!.resource).toMatch(/:riders$/);
    expect(bindings.get(3)!.resource).toMatch(/:tile-counts$/);
    expect(bindings.get(4)!.resource).toMatch(/:tile-indices$/);
    for (const binding of [1, 2, 3, 4]) {
      expect(bindings.get(binding)!.kind).toBe('read-only-storage');
    }

    // The render pass must read the density buffer the sim just WROTE.
    const advectDensity = passByName(graph.config.passes as Pass[], 'smoke-riders-advect-density');
    expect(bindings.get(1)!.resource)
      .toBe(advectDensity.bindings.find((b) => b.binding === 3)!.resource);
  });

  it('seeds the rider population once and reuses it across frames', () => {
    const first = buildGraph();
    const seeded = first.config.buffers.find((b) => b.id.endsWith(':riders'))!;
    expect(seeded.clear).toBe(true);
    expect(typeof seeded.initial_b64).toBe('string');
    // 12 floats per rider.
    expect(seeded.byte_length).toBe(first.riderCount * 12 * 4);

    const second = buildSmokeRidersNativeComputeGraph({
      sourceId: 'gpu:layer-a:smoke-riders',
      params: { quality: 'performance', style: 'paint', riderCount: 128 },
      width: 640,
      height: 360,
      time: 1 + 1 / 60,
      frameDelta: 1 / 60,
      frameIndex: 11,
      state: first.state,
    });
    const reused = second.config.buffers.find((b) => b.id.endsWith(':riders'))!;
    expect(reused.clear).toBe(false);
    expect(reused.initial_b64).toBeUndefined();
    expect(reused.id).toBe(seeded.id);

    // Velocity ping-pongs four times per frame — advect, vorticity,
    // surface tension, projection — so it lands back on the buffer it
    // started from; density flips once. Either way the render pass has
    // to follow whichever buffer the sim last WROTE, so assert against
    // the pass wiring rather than against a hardcoded parity.
    expect(second.state.velFlip).toBe(first.state.velFlip);
    expect(second.state.denFlip).not.toBe(first.state.denFlip);
    const secondDensity = (second.config.passes as Pass[])
      .find((pass) => pass.name === 'smoke-riders-advect-density')!;
    const written = secondDensity.bindings
      .find((b) => b.kind === 'storage' && /density-[ab]$/.test(b.resource))!.resource;
    expect(second.config.render_passes[0].bindings.find((b) => b.binding === 1)!.resource)
      .toBe(written);
  });

  it('reseeds when the rider population or grid resolution changes', () => {
    const base = buildGraph();
    const moreRiders = buildSmokeRidersNativeComputeGraph({
      sourceId: 'gpu:layer-a:smoke-riders',
      params: { quality: 'performance', style: 'paint', riderCount: 256 },
      width: 640,
      height: 360,
      time: 2,
      frameDelta: 1 / 60,
      frameIndex: 12,
      state: base.state,
    });
    const buffer = moreRiders.config.buffers.find((b) => b.id.endsWith(':riders'))!;
    expect(buffer.clear).toBe(true);
    expect(typeof buffer.initial_b64).toBe('string');
    expect(buffer.id).not.toBe(base.config.buffers.find((b) => b.id.endsWith(':riders'))!.id);
  });

  it('scales the jacobi iteration count with quality but keeps every tier at 20+', () => {
    const perf = buildGraph({ quality: 'performance' });
    const ultra = buildGraph({ quality: 'ultra' });
    const jacobiCount = (graph: ReturnType<typeof buildGraph>) =>
      graph.config.passes.filter((pass) => pass.name.startsWith('smoke-riders-jacobi-')).length;
    expect(jacobiCount(perf)).toBe(20);
    expect(jacobiCount(ultra)).toBe(24);
    expect(perf.config.readbacks).toEqual([]);
  });
});
