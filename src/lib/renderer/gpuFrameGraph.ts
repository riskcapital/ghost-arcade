import type {
  GhostGpuBufferHandle,
  GhostGpuTextureHandle,
} from './gpuRuntime';

export type GhostGpuFrameGraphPassKind = 'compute' | 'render' | 'copy' | 'custom';
export type GhostGpuFrameGraphResourceKind = 'buffer' | 'texture';

export interface GhostGpuFrameGraphPassStats {
  name: string;
  kind: GhostGpuFrameGraphPassKind;
  cpuMs: number;
}

export interface GhostGpuFrameGraphRunStats {
  passes: GhostGpuFrameGraphPassStats[];
  totalCpuMs: number;
}

export interface GhostGpuFrameGraphContext {
  runtime: GhostGpuFrameGraphRuntime;
  device: any;
  encoder: any;
  getBuffer(name: string): any;
  getTexture(name: string): any;
}

export interface GhostGpuFrameGraphPass {
  name: string;
  kind?: GhostGpuFrameGraphPassKind;
  reads?: string[];
  writes?: string[];
  execute(ctx: GhostGpuFrameGraphContext): void;
}

type BufferDeclaration = {
  kind: 'buffer';
  name: string;
  size: number;
  usage: number;
  label?: string;
  imported?: any;
};

type TextureDeclaration = {
  kind: 'texture';
  name: string;
  descriptor: Record<string, any>;
  label?: string;
  imported?: any;
};

type ResourceDeclaration = BufferDeclaration | TextureDeclaration;
type ResourceAllocation =
  | { kind: 'buffer'; buffer: any; handle: GhostGpuBufferHandle | null }
  | { kind: 'texture'; texture: any; handle: GhostGpuTextureHandle | null };

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function stableUnique(values: Iterable<string>): string[] {
  return [...new Set([...values])];
}

export class GhostGpuFrameGraph {
  private resources = new Map<string, ResourceDeclaration>();
  private passes: GhostGpuFrameGraphPass[] = [];

  constructor(readonly runtime: GhostGpuFrameGraphRuntime) {}

  declareBuffer(name: string, size: number, usage: number, label = name): this {
    this.assertUnusedResource(name);
    this.resources.set(name, { kind: 'buffer', name, size, usage, label });
    return this;
  }

  importBuffer(name: string, buffer: any, size = 0, usage = 0, label = name): this {
    this.assertUnusedResource(name);
    this.resources.set(name, { kind: 'buffer', name, size, usage, label, imported: buffer });
    return this;
  }

  declareTexture(name: string, descriptor: Record<string, any>, label = name): this {
    this.assertUnusedResource(name);
    this.resources.set(name, { kind: 'texture', name, descriptor: { ...descriptor }, label });
    return this;
  }

  importTexture(name: string, texture: any, descriptor: Record<string, any> = {}, label = name): this {
    this.assertUnusedResource(name);
    this.resources.set(name, { kind: 'texture', name, descriptor: { ...descriptor }, label, imported: texture });
    return this;
  }

  addPass(pass: GhostGpuFrameGraphPass): this {
    if (!pass.name.trim()) throw new Error('Frame graph pass name cannot be empty');
    this.passes.push({
      ...pass,
      kind: pass.kind ?? 'custom',
      reads: stableUnique(pass.reads ?? []),
      writes: stableUnique(pass.writes ?? []),
    });
    return this;
  }

  clearPasses(): void {
    this.passes = [];
  }

  execute(encoder: any): GhostGpuFrameGraphRunStats {
    const order = this.sortedPasses();
    const allocations = this.allocateResources();
    const start = nowMs();
    const stats: GhostGpuFrameGraphPassStats[] = [];
    const ctx: GhostGpuFrameGraphContext = {
      runtime: this.runtime,
      device: this.runtime.device,
      encoder,
      getBuffer: (name) => this.getAllocatedBuffer(allocations, name),
      getTexture: (name) => this.getAllocatedTexture(allocations, name),
    };

    try {
      for (const pass of order) {
        const passStart = nowMs();
        pass.execute(ctx);
        stats.push({
          name: pass.name,
          kind: pass.kind ?? 'custom',
          cpuMs: nowMs() - passStart,
        });
      }
    } finally {
      this.releaseTransientResources(allocations);
    }

    return {
      passes: stats,
      totalCpuMs: nowMs() - start,
    };
  }

  sortedPassNames(): string[] {
    return this.sortedPasses().map((pass) => pass.name);
  }

  private sortedPasses(): GhostGpuFrameGraphPass[] {
    this.validateResourceReferences();
    const dependencies = this.buildDependencies();
    const ready = new Set<number>();
    const remaining = new Set<number>();
    for (let i = 0; i < this.passes.length; i++) {
      remaining.add(i);
      if ((dependencies.get(i)?.size ?? 0) === 0) ready.add(i);
    }

    const order: GhostGpuFrameGraphPass[] = [];
    while (ready.size > 0) {
      const index = Math.min(...ready);
      ready.delete(index);
      remaining.delete(index);
      order.push(this.passes[index]);

      for (const other of [...remaining]) {
        const deps = dependencies.get(other);
        if (!deps?.delete(index)) continue;
        if (deps.size === 0) ready.add(other);
      }
    }

    if (remaining.size > 0) {
      const names = [...remaining].map((index) => this.passes[index]?.name ?? `#${index}`).join(', ');
      throw new Error(`Frame graph contains a dependency cycle: ${names}`);
    }

    return order;
  }

  private buildDependencies(): Map<number, Set<number>> {
    const writersByResource = new Map<string, number[]>();
    this.passes.forEach((pass, index) => {
      for (const resource of pass.writes ?? []) {
        const writers = writersByResource.get(resource) ?? [];
        writers.push(index);
        writersByResource.set(resource, writers);
      }
    });

    const dependencies = new Map<number, Set<number>>();
    const addDependency = (passIndex: number, dependencyIndex: number | undefined) => {
      if (dependencyIndex === undefined || dependencyIndex === passIndex) return;
      const deps = dependencies.get(passIndex) ?? new Set<number>();
      deps.add(dependencyIndex);
      dependencies.set(passIndex, deps);
    };

    this.passes.forEach((pass, index) => {
      for (const resource of pass.reads ?? []) {
        const writers = writersByResource.get(resource) ?? [];
        const previousWriter = [...writers].reverse().find((writer) => writer < index);
        if (previousWriter !== undefined) addDependency(index, previousWriter);
        else if (!this.canReadInitialResource(resource)) addDependency(index, writers[0]);
      }
      for (const resource of pass.writes ?? []) {
        const writers = writersByResource.get(resource) ?? [];
        const previousWriter = [...writers].reverse().find((writer) => writer < index);
        addDependency(index, previousWriter);
      }
      if (!dependencies.has(index)) dependencies.set(index, new Set());
    });

    return dependencies;
  }

  private allocateResources(): Map<string, ResourceAllocation> {
    const allocations = new Map<string, ResourceAllocation>();
    for (const [name, declaration] of this.resources) {
      if (declaration.kind === 'buffer') {
        if (declaration.imported) {
          allocations.set(name, { kind: 'buffer', buffer: declaration.imported, handle: null });
          continue;
        }
        const handle = this.requireResourcePool().acquireBuffer(declaration.size, declaration.usage, declaration.label);
        allocations.set(name, { kind: 'buffer', buffer: handle.buffer, handle });
      } else {
        if (declaration.imported) {
          allocations.set(name, { kind: 'texture', texture: declaration.imported, handle: null });
          continue;
        }
        const handle = this.requireResourcePool().acquireTexture(declaration.descriptor, declaration.label);
        allocations.set(name, { kind: 'texture', texture: handle.texture, handle });
      }
    }
    return allocations;
  }

  private releaseTransientResources(allocations: Map<string, ResourceAllocation>): void {
    for (const allocation of allocations.values()) {
      try { allocation.handle?.release(); } catch { /* device loss or already released */ }
    }
  }

  private getAllocatedBuffer(allocations: Map<string, ResourceAllocation>, name: string): any {
    const allocation = allocations.get(name);
    if (allocation?.kind !== 'buffer') throw new Error(`Frame graph buffer not found: ${name}`);
    return allocation.buffer;
  }

  private getAllocatedTexture(allocations: Map<string, ResourceAllocation>, name: string): any {
    const allocation = allocations.get(name);
    if (allocation?.kind !== 'texture') throw new Error(`Frame graph texture not found: ${name}`);
    return allocation.texture;
  }

  private validateResourceReferences(): void {
    for (const pass of this.passes) {
      for (const resource of [...(pass.reads ?? []), ...(pass.writes ?? [])]) {
        if (!this.resources.has(resource)) {
          throw new Error(`Frame graph pass "${pass.name}" references unknown resource "${resource}"`);
        }
      }
    }
  }

  private assertUnusedResource(name: string): void {
    if (this.resources.has(name)) throw new Error(`Frame graph resource already exists: ${name}`);
  }

  private canReadInitialResource(name: string): boolean {
    return !!this.resources.get(name)?.imported;
  }

  private requireResourcePool(): NonNullable<GhostGpuFrameGraphRuntime['resources']> {
    if (!this.runtime.resources) {
      throw new Error('Frame graph transient resources require a Ghost GPU runtime resource pool');
    }
    return this.runtime.resources;
  }
}
export interface GhostGpuFrameGraphRuntime {
  readonly device: any;
  readonly resources?: {
    acquireBuffer(size: number, usage: number, label?: string): GhostGpuBufferHandle;
    acquireTexture(descriptor: Record<string, any>, label?: string): GhostGpuTextureHandle;
  };
}
