import { describe, expect, it } from 'vitest';
import { WebGhostGpuRuntime } from './gpuRuntime';
import { GhostGpuFrameGraph } from './gpuFrameGraph';

function createMockDevice() {
  let bufferId = 0;
  let textureId = 0;
  return {
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
      descriptor,
      getCompilationInfo: async () => ({ messages: [] }),
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

function createRuntime(): WebGhostGpuRuntime {
  return new WebGhostGpuRuntime(createMockDevice(), MOCK_CAPS);
}

describe('GhostGpuFrameGraph', () => {
  it('orders passes by declared resource dependencies', () => {
    const runtime = createRuntime();
    const graph = new GhostGpuFrameGraph(runtime);
    const order: string[] = [];

    graph
      .declareBuffer('scratch', 16, 7)
      .addPass({
        name: 'consume',
        reads: ['scratch'],
        execute: () => order.push('consume'),
      })
      .addPass({
        name: 'produce',
        writes: ['scratch'],
        execute: () => order.push('produce'),
      });

    expect(graph.sortedPassNames()).toEqual(['produce', 'consume']);
    graph.execute({});
    expect(order).toEqual(['produce', 'consume']);
  });

  it('allocates transient resources through the runtime pool', () => {
    const runtime = createRuntime();
    const firstGraph = new GhostGpuFrameGraph(runtime);
    let firstBuffer: any = null;

    firstGraph
      .declareBuffer('scratch', 16, 7)
      .addPass({
        name: 'use-scratch',
        reads: ['scratch'],
        execute: (ctx) => { firstBuffer = ctx.getBuffer('scratch'); },
      })
      .execute({});

    expect(runtime.stats().buffersInPool).toBe(1);

    const secondGraph = new GhostGpuFrameGraph(runtime);
    let secondBuffer: any = null;
    secondGraph
      .declareBuffer('scratch', 16, 7)
      .addPass({
        name: 'use-scratch-again',
        reads: ['scratch'],
        execute: (ctx) => { secondBuffer = ctx.getBuffer('scratch'); },
      })
      .execute({});

    expect(secondBuffer).toBe(firstBuffer);
    expect(runtime.stats().buffersCreated).toBe(1);
    expect(runtime.stats().buffersReused).toBe(1);
  });

  it('does not release imported resources', () => {
    const runtime = createRuntime();
    const graph = new GhostGpuFrameGraph(runtime);
    const externalBuffer = { id: 'external', destroyed: false };
    let seenBuffer: any = null;

    graph
      .importBuffer('input', externalBuffer)
      .addPass({
        name: 'read-imported',
        reads: ['input'],
        execute: (ctx) => { seenBuffer = ctx.getBuffer('input'); },
      })
      .execute({});

    expect(seenBuffer).toBe(externalBuffer);
    expect(runtime.stats().buffersCreated).toBe(0);
    expect(runtime.stats().buffersInPool).toBe(0);
  });

  it('allows imported ping-pong resources to be read before later writes', () => {
    const graph = new GhostGpuFrameGraph(createRuntime());

    graph
      .importBuffer('a', { id: 'a' })
      .importBuffer('b', { id: 'b' })
      .addPass({
        name: 'ping',
        reads: ['a'],
        writes: ['b'],
        execute: () => {},
      })
      .addPass({
        name: 'pong',
        reads: ['b'],
        writes: ['a'],
        execute: () => {},
      });

    expect(graph.sortedPassNames()).toEqual(['ping', 'pong']);
  });

  it('orders in-place imported resource updates before later readers', () => {
    const graph = new GhostGpuFrameGraph(createRuntime());

    graph
      .importBuffer('particles', { id: 'particles' })
      .importBuffer('uniforms', { id: 'uniforms' })
      .addPass({
        name: 'behavior',
        reads: ['particles', 'uniforms'],
        writes: ['particles'],
        execute: () => {},
      })
      .addPass({
        name: 'render',
        reads: ['particles'],
        execute: () => {},
      });

    expect(graph.sortedPassNames()).toEqual(['behavior', 'render']);
  });

  it('throws on dependency cycles', () => {
    const graph = new GhostGpuFrameGraph(createRuntime());

    graph
      .declareBuffer('a', 16, 7)
      .declareBuffer('b', 16, 7)
      .addPass({
        name: 'write-a',
        reads: ['b'],
        writes: ['a'],
        execute: () => {},
      })
      .addPass({
        name: 'write-b',
        reads: ['a'],
        writes: ['b'],
        execute: () => {},
      });

    expect(() => graph.sortedPassNames()).toThrow('dependency cycle');
  });
});
