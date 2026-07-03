import { describe, expect, it } from 'vitest';
import { GhostGpuResourcePool, WebGhostGpuRuntime } from './gpuRuntime';

function createMockDevice(options: { queue?: any } = {}) {
  let bufferId = 0;
  let textureId = 0;
  let shaderId = 0;
  let renderPipelineId = 0;
  let computePipelineId = 0;
  return {
    ...options,
    createBuffer: (descriptor: any) => ({
      id: ++bufferId,
      descriptor,
      destroyed: false,
      destroy() { this.destroyed = true; },
    }),
    createTexture: (descriptor: any) => ({
      id: ++textureId,
      descriptor,
      destroyed: false,
      destroy() { this.destroyed = true; },
    }),
    createShaderModule: (descriptor: any) => ({
      id: ++shaderId,
      descriptor,
      getCompilationInfo: async () => ({ messages: [] }),
    }),
    createRenderPipeline: (descriptor: any) => ({
      id: ++renderPipelineId,
      kind: 'render',
      descriptor,
    }),
    createComputePipeline: (descriptor: any) => ({
      id: ++computePipelineId,
      kind: 'compute',
      descriptor,
    }),
    createRenderPipelineAsync: async (descriptor: any) => ({
      id: ++renderPipelineId,
      kind: 'render-async',
      descriptor,
    }),
    createComputePipelineAsync: async (descriptor: any) => ({
      id: ++computePipelineId,
      kind: 'compute-async',
      descriptor,
    }),
  };
}

const MOCK_CAPS: any = {
  supported: true,
  description: 'mock',
  presentFormat: 'bgra8unorm',
  qualityTier: 'high',
  quality: { tier: 'high', label: 'High' },
};

describe('GhostGpuResourcePool', () => {
  it('creates stable texture keys regardless of object key order', () => {
    const a = GhostGpuResourcePool.textureKey({
      format: 'rgba8unorm',
      usage: 1,
      size: { width: 64, height: 32, depthOrArrayLayers: 1 },
    });
    const b = GhostGpuResourcePool.textureKey({
      size: { depthOrArrayLayers: 1, height: 32, width: 64 },
      usage: 1,
      format: 'rgba8unorm',
    });

    expect(a).toBe(b);
  });

  it('reuses released buffers with matching size and usage', () => {
    const pool = new GhostGpuResourcePool(createMockDevice());
    const first = pool.acquireBuffer(15, 7, 'a');
    const firstBuffer = first.buffer;
    first.release();
    const second = pool.acquireBuffer(16, 7, 'b');

    expect(second.buffer).toBe(firstBuffer);
    expect(pool.stats().buffersCreated).toBe(1);
    expect(pool.stats().buffersReused).toBe(1);
  });

  it('reuses released textures with matching descriptors', () => {
    const pool = new GhostGpuResourcePool(createMockDevice());
    const descriptor = {
      size: { width: 16, height: 16, depthOrArrayLayers: 1 },
      format: 'rgba8unorm',
      usage: 3,
    };
    const first = pool.acquireTexture(descriptor, 'a');
    const firstTexture = first.texture;
    first.release();
    const second = pool.acquireTexture({ ...descriptor }, 'b');

    expect(second.texture).toBe(firstTexture);
    expect(pool.stats().texturesCreated).toBe(1);
    expect(pool.stats().texturesReused).toBe(1);
  });

  it('waits for submitted queue work before reusing released buffers', async () => {
    let finishWork!: () => void;
    const submittedWorkDone = new Promise<void>((resolve) => { finishWork = resolve; });
    const pool = new GhostGpuResourcePool(createMockDevice({
      queue: { onSubmittedWorkDone: () => submittedWorkDone },
    }));
    const first = pool.acquireBuffer(15, 7, 'a');
    const firstBuffer = first.buffer;

    first.release();
    const second = pool.acquireBuffer(16, 7, 'b');
    expect(second.buffer).not.toBe(firstBuffer);

    finishWork();
    await submittedWorkDone;
    await Promise.resolve();

    const third = pool.acquireBuffer(16, 7, 'c');
    expect(third.buffer).toBe(firstBuffer);
    expect(pool.stats().buffersCreated).toBe(2);
    expect(pool.stats().buffersReused).toBe(1);
  });

  it('destroys pending releases when disposed before the queue completes', async () => {
    let finishWork!: () => void;
    const submittedWorkDone = new Promise<void>((resolve) => { finishWork = resolve; });
    const pool = new GhostGpuResourcePool(createMockDevice({
      queue: { onSubmittedWorkDone: () => submittedWorkDone },
    }));
    const handle = pool.acquireBuffer(16, 7, 'a');
    const buffer = handle.buffer;

    handle.release();
    pool.dispose();
    finishWork();
    await submittedWorkDone;
    await Promise.resolve();

    expect(buffer.destroyed).toBe(true);
    expect(pool.stats().buffersInPool).toBe(0);
  });
});

describe('WebGhostGpuRuntime', () => {
  it('caches resolved shader modules by source and label', () => {
    const runtime = new WebGhostGpuRuntime(createMockDevice(), MOCK_CAPS);
    const first = runtime.warmShaderModule('#include <color>\nfn main() {}', 'test');
    const second = runtime.warmShaderModule('#include <color>\nfn main() {}', 'test');

    expect(second).toBe(first);
    expect(runtime.stats().shaderModulesCreated).toBe(1);
    expect(runtime.stats().shaderModuleCacheHits).toBe(1);
    expect(first.descriptor.code).toContain('ghost_premul');
  });

  it('caches sync render and compute pipeline creation by explicit key', () => {
    const runtime = new WebGhostGpuRuntime(createMockDevice(), MOCK_CAPS);
    const renderDescriptor = { label: 'render', vertex: {}, fragment: {}, primitive: {} };
    const computeDescriptor = { label: 'compute', compute: {} };

    const firstRender = runtime.createRenderPipeline(renderDescriptor, 'render-key');
    const secondRender = runtime.createRenderPipeline({ ...renderDescriptor }, 'render-key');
    const firstCompute = runtime.createComputePipeline(computeDescriptor, 'compute-key');
    const secondCompute = runtime.createComputePipeline({ ...computeDescriptor }, 'compute-key');

    expect(secondRender).toBe(firstRender);
    expect(secondCompute).toBe(firstCompute);
    expect(runtime.stats().renderPipelinesCreated).toBe(1);
    expect(runtime.stats().renderPipelineCacheHits).toBe(1);
    expect(runtime.stats().computePipelinesCreated).toBe(1);
    expect(runtime.stats().computePipelineCacheHits).toBe(1);
  });

  it('dedupes async pipeline warmups and serves later sync requests from cache', async () => {
    const runtime = new WebGhostGpuRuntime(createMockDevice(), MOCK_CAPS);
    const renderDescriptor = { label: 'render-warm', vertex: {}, fragment: {}, primitive: {} };
    const computeDescriptor = { label: 'compute-warm', compute: {} };

    const pendingRenderA = runtime.warmRenderPipeline(renderDescriptor, 'render-warm-key');
    const pendingRenderB = runtime.warmRenderPipeline({ ...renderDescriptor }, 'render-warm-key');
    const pendingComputeA = runtime.warmComputePipeline(computeDescriptor, 'compute-warm-key');
    const pendingComputeB = runtime.warmComputePipeline({ ...computeDescriptor }, 'compute-warm-key');

    expect(pendingRenderB).toBe(pendingRenderA);
    expect(pendingComputeB).toBe(pendingComputeA);
    expect(runtime.stats().pendingPipelineWarmups).toBe(2);

    const warmedRender = await pendingRenderA;
    const warmedCompute = await pendingComputeA;

    expect(await pendingRenderB).toBe(warmedRender);
    expect(await pendingComputeB).toBe(warmedCompute);
    expect(runtime.createRenderPipeline(renderDescriptor, 'render-warm-key')).toBe(warmedRender);
    expect(runtime.createComputePipeline(computeDescriptor, 'compute-warm-key')).toBe(warmedCompute);
    expect(runtime.stats().renderPipelineWarmups).toBe(1);
    expect(runtime.stats().computePipelineWarmups).toBe(1);
    expect(runtime.stats().pendingPipelineWarmups).toBe(0);
  });
});
