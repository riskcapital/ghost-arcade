import type { GhostGpuCaps } from './gpuCaps';
import { WGSL_STDLIB } from './wgsl/modules';
import { resolveWgslIncludes } from './wgsl/resolveIncludes';

export type GhostGpuBackendKind = 'webgpu-browser' | 'wgpu-native';

export interface GhostGpuRuntimeStats {
  shaderModulesCreated: number;
  shaderModuleCacheHits: number;
  renderPipelinesCreated: number;
  renderPipelineCacheHits: number;
  renderPipelineWarmups: number;
  computePipelinesCreated: number;
  computePipelineCacheHits: number;
  computePipelineWarmups: number;
  pendingPipelineWarmups: number;
  buffersCreated: number;
  buffersReused: number;
  buffersInPool: number;
  texturesCreated: number;
  texturesReused: number;
  texturesInPool: number;
  pooledBytes: number;
}

export interface GhostGpuRuntime {
  readonly backend: GhostGpuBackendKind;
  readonly device: any;
  readonly caps: GhostGpuCaps;
  readonly resources: GhostGpuResourcePool;
  createShaderModule(source: string, label?: string): any;
  warmShaderModule(source: string, label?: string): any;
  createRenderPipeline(descriptor: Record<string, any>, key?: string): any;
  createComputePipeline(descriptor: Record<string, any>, key?: string): any;
  warmRenderPipeline(descriptor: Record<string, any>, key?: string): Promise<any>;
  warmComputePipeline(descriptor: Record<string, any>, key?: string): Promise<any>;
  stats(): GhostGpuRuntimeStats;
  dispose(): void;
}

export interface GhostGpuBufferHandle {
  buffer: any;
  size: number;
  usage: number;
  label?: string;
  release(): void;
}

export interface GhostGpuTextureHandle {
  texture: any;
  descriptor: Record<string, any>;
  label?: string;
  release(): void;
}

type PooledBuffer = {
  buffer: any;
  size: number;
  usage: number;
  label?: string;
};

type PooledTexture = {
  texture: any;
  descriptor: Record<string, any>;
  label?: string;
};

export interface GhostGpuResourcePoolOptions {
  maxPooledBuffers?: number;
  maxPooledTextures?: number;
  maxPooledBytes?: number;
}

const DEFAULT_POOL_OPTIONS: Required<GhostGpuResourcePoolOptions> = {
  maxPooledBuffers: 96,
  maxPooledTextures: 48,
  maxPooledBytes: 256 * 1024 * 1024,
};

function alignBufferSize(size: number): number {
  return Math.max(4, Math.ceil(Math.max(0, size) / 4) * 4);
}

function stableStringify(value: any): string {
  if (value === null || typeof value !== 'object') return String(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${key}:${stableStringify(value[key])}`).join(',')}}`;
}

function textureByteEstimate(descriptor: Record<string, any>): number {
  const size = descriptor.size;
  const width = typeof size?.width === 'number' ? size.width : Array.isArray(size) ? size[0] : 1;
  const height = typeof size?.height === 'number' ? size.height : Array.isArray(size) ? size[1] : 1;
  const depth = typeof size?.depthOrArrayLayers === 'number' ? size.depthOrArrayLayers : Array.isArray(size) ? (size[2] ?? 1) : 1;
  const format = String(descriptor.format ?? '');
  const bytesPerPixel = format.includes('rgba16float') ? 8
    : format.includes('rgba32float') ? 16
    : format.includes('r32float') ? 4
    : format.includes('depth24plus') ? 4
    : format.includes('depth32float') ? 4
    : 4;
  return Math.max(1, width) * Math.max(1, height) * Math.max(1, depth) * bytesPerPixel;
}

function hashString(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function summarizePipelineValue(value: any): any {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(summarizePipelineValue);
  if ('descriptor' in value && value.descriptor?.label) return { label: value.descriptor.label };
  if ('label' in value && typeof value.label === 'string') return { label: value.label };
  const out: Record<string, any> = {};
  for (const key of Object.keys(value).sort()) {
    const v = value[key];
    if (typeof v === 'function') continue;
    if (key === 'module') {
      out[key] = summarizePipelineValue(v);
    } else if (
      key === 'label' ||
      key === 'layout' ||
      key === 'entryPoint' ||
      key === 'topology' ||
      key === 'format' ||
      key === 'targets' ||
      key === 'vertex' ||
      key === 'fragment' ||
      key === 'compute' ||
      key === 'primitive' ||
      key === 'buffers'
    ) {
      out[key] = summarizePipelineValue(v);
    }
  }
  return out;
}

function pipelineKey(kind: 'render' | 'compute', descriptor: Record<string, any>, key?: string): string {
  const explicit = key || descriptor.label;
  if (explicit) return `${kind}:${explicit}`;
  return `${kind}:${hashString(stableStringify(summarizePipelineValue(descriptor)))}`;
}

export class GhostGpuResourcePool {
  private options: Required<GhostGpuResourcePoolOptions>;
  private buffers = new Map<string, PooledBuffer[]>();
  private textures = new Map<string, PooledTexture[]>();
  private pooledBytes = 0;
  private createdBuffers = 0;
  private reusedBuffers = 0;
  private createdTextures = 0;
  private reusedTextures = 0;
  private disposed = false;

  constructor(private device: any, options: GhostGpuResourcePoolOptions = {}) {
    this.options = { ...DEFAULT_POOL_OPTIONS, ...options };
  }

  static bufferKey(size: number, usage: number): string {
    return `${alignBufferSize(size)}:${usage >>> 0}`;
  }

  static textureKey(descriptor: Record<string, any>): string {
    const stableDescriptor = {
      dimension: descriptor.dimension ?? '2d',
      format: descriptor.format,
      mipLevelCount: descriptor.mipLevelCount ?? 1,
      sampleCount: descriptor.sampleCount ?? 1,
      size: descriptor.size,
      usage: descriptor.usage,
      viewFormats: descriptor.viewFormats ?? [],
    };
    return stableStringify(stableDescriptor);
  }

  acquireBuffer(size: number, usage: number, label?: string): GhostGpuBufferHandle {
    const alignedSize = alignBufferSize(size);
    const key = GhostGpuResourcePool.bufferKey(alignedSize, usage);
    const bucket = this.buffers.get(key);
    const pooled = bucket?.pop();
    if (pooled) {
      this.reusedBuffers++;
      this.pooledBytes = Math.max(0, this.pooledBytes - pooled.size);
      return this.wrapBuffer(pooled.buffer, alignedSize, usage, label);
    }
    this.createdBuffers++;
    const descriptor: Record<string, any> = { size: alignedSize, usage };
    if (label) descriptor.label = label;
    return this.wrapBuffer(this.device.createBuffer(descriptor), alignedSize, usage, label);
  }

  acquireTexture(descriptor: Record<string, any>, label?: string): GhostGpuTextureHandle {
    const normalized = { ...descriptor };
    if (label) normalized.label = label;
    const key = GhostGpuResourcePool.textureKey(normalized);
    const bucket = this.textures.get(key);
    const pooled = bucket?.pop();
    if (pooled) {
      this.reusedTextures++;
      this.pooledBytes = Math.max(0, this.pooledBytes - textureByteEstimate(pooled.descriptor));
      return this.wrapTexture(pooled.texture, normalized, label);
    }
    this.createdTextures++;
    return this.wrapTexture(this.device.createTexture(normalized), normalized, label);
  }

  releaseBuffer(buffer: any, size: number, usage: number, label?: string): void {
    if (!buffer) return;
    const alignedSize = alignBufferSize(size);
    if (alignedSize > this.options.maxPooledBytes) {
      this.destroyResource(buffer);
      return;
    }
    this.releaseAfterSubmittedWork(
      () => {
        if (this.disposed || !this.canAcceptBuffer(alignedSize)) {
          this.destroyResource(buffer);
          return;
        }
        const key = GhostGpuResourcePool.bufferKey(alignedSize, usage);
        const bucket = this.buffers.get(key) ?? [];
        bucket.push({ buffer, size: alignedSize, usage, label });
        this.buffers.set(key, bucket);
        this.pooledBytes += alignedSize;
        this.trim();
      },
      () => this.destroyResource(buffer),
    );
  }

  releaseTexture(texture: any, descriptor: Record<string, any>, label?: string): void {
    if (!texture) return;
    const bytes = textureByteEstimate(descriptor);
    if (bytes > this.options.maxPooledBytes) {
      this.destroyResource(texture);
      return;
    }
    this.releaseAfterSubmittedWork(
      () => {
        if (this.disposed || !this.canAcceptTexture(bytes)) {
          this.destroyResource(texture);
          return;
        }
        const key = GhostGpuResourcePool.textureKey(descriptor);
        const bucket = this.textures.get(key) ?? [];
        bucket.push({ texture, descriptor: { ...descriptor }, label });
        this.textures.set(key, bucket);
        this.pooledBytes += bytes;
        this.trim();
      },
      () => this.destroyResource(texture),
    );
  }

  stats(): Pick<GhostGpuRuntimeStats,
    'buffersCreated' | 'buffersReused' | 'buffersInPool' |
    'texturesCreated' | 'texturesReused' | 'texturesInPool' | 'pooledBytes'> {
    let buffersInPool = 0;
    let texturesInPool = 0;
    for (const bucket of this.buffers.values()) buffersInPool += bucket.length;
    for (const bucket of this.textures.values()) texturesInPool += bucket.length;
    return {
      buffersCreated: this.createdBuffers,
      buffersReused: this.reusedBuffers,
      buffersInPool,
      texturesCreated: this.createdTextures,
      texturesReused: this.reusedTextures,
      texturesInPool,
      pooledBytes: this.pooledBytes,
    };
  }

  trim(): void {
    while (this.pooledBytes > this.options.maxPooledBytes || this.countBuffers() > this.options.maxPooledBuffers) {
      if (!this.destroyOneBuffer()) break;
    }
    while (this.countTextures() > this.options.maxPooledTextures) {
      if (!this.destroyOneTexture()) break;
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const bucket of this.buffers.values()) {
      for (const item of bucket) this.destroyResource(item.buffer);
    }
    for (const bucket of this.textures.values()) {
      for (const item of bucket) this.destroyResource(item.texture);
    }
    this.buffers.clear();
    this.textures.clear();
    this.pooledBytes = 0;
  }

  private releaseAfterSubmittedWork(onReady: () => void, onRejected: () => void): void {
    const queue = this.device?.queue;
    if (typeof queue?.onSubmittedWorkDone === 'function') {
      void queue.onSubmittedWorkDone().then(onReady).catch(onRejected);
      return;
    }
    onReady();
  }

  private wrapBuffer(buffer: any, size: number, usage: number, label?: string): GhostGpuBufferHandle {
    let released = false;
    return {
      buffer,
      size,
      usage,
      label,
      release: () => {
        if (released) return;
        released = true;
        this.releaseBuffer(buffer, size, usage, label);
      },
    };
  }

  private wrapTexture(texture: any, descriptor: Record<string, any>, label?: string): GhostGpuTextureHandle {
    let released = false;
    return {
      texture,
      descriptor,
      label,
      release: () => {
        if (released) return;
        released = true;
        this.releaseTexture(texture, descriptor, label);
      },
    };
  }

  private canAcceptBuffer(size: number): boolean {
    return size <= this.options.maxPooledBytes && this.countBuffers() < this.options.maxPooledBuffers;
  }

  private canAcceptTexture(bytes: number): boolean {
    return bytes <= this.options.maxPooledBytes && this.countTextures() < this.options.maxPooledTextures;
  }

  private countBuffers(): number {
    let count = 0;
    for (const bucket of this.buffers.values()) count += bucket.length;
    return count;
  }

  private countTextures(): number {
    let count = 0;
    for (const bucket of this.textures.values()) count += bucket.length;
    return count;
  }

  private destroyOneBuffer(): boolean {
    for (const [key, bucket] of this.buffers) {
      const item = bucket.shift();
      if (!item) continue;
      this.pooledBytes = Math.max(0, this.pooledBytes - item.size);
      this.destroyResource(item.buffer);
      if (bucket.length === 0) this.buffers.delete(key);
      return true;
    }
    return false;
  }

  private destroyOneTexture(): boolean {
    for (const [key, bucket] of this.textures) {
      const item = bucket.shift();
      if (!item) continue;
      this.pooledBytes = Math.max(0, this.pooledBytes - textureByteEstimate(item.descriptor));
      this.destroyResource(item.texture);
      if (bucket.length === 0) this.textures.delete(key);
      return true;
    }
    return false;
  }

  private destroyResource(resource: any): void {
    try {
      if (typeof resource?.destroy === 'function') resource.destroy();
    } catch {
      // Device loss or already-destroyed resources should not cascade.
    }
  }
}

export class WebGhostGpuRuntime implements GhostGpuRuntime {
  readonly backend: GhostGpuBackendKind = 'webgpu-browser';
  readonly resources: GhostGpuResourcePool;
  private shaderModules = new Map<string, any>();
  private renderPipelines = new Map<string, any>();
  private computePipelines = new Map<string, any>();
  private pendingRenderPipelineWarmups = new Map<string, Promise<any>>();
  private pendingComputePipelineWarmups = new Map<string, Promise<any>>();
  private shaderModulesCreated = 0;
  private shaderModuleCacheHits = 0;
  private renderPipelinesCreated = 0;
  private renderPipelineCacheHits = 0;
  private renderPipelineWarmups = 0;
  private computePipelinesCreated = 0;
  private computePipelineCacheHits = 0;
  private computePipelineWarmups = 0;

  constructor(
    readonly device: any,
    readonly caps: GhostGpuCaps,
    options: GhostGpuResourcePoolOptions = {},
  ) {
    this.resources = new GhostGpuResourcePool(device, options);
  }

  createShaderModule(source: string, label?: string): any {
    const resolved = resolveWgslIncludes(source, {
      modules: WGSL_STDLIB,
      sourceName: label ?? 'shader',
    });
    const key = `${label ?? ''}:${hashString(resolved)}`;
    const cached = this.shaderModules.get(key);
    if (cached) {
      this.shaderModuleCacheHits++;
      return cached;
    }
    const descriptor: Record<string, any> = { code: resolved };
    if (label) descriptor.label = label;
    const module = this.device.createShaderModule(descriptor);
    this.shaderModules.set(key, module);
    this.shaderModulesCreated++;
    return module;
  }

  warmShaderModule(source: string, label?: string): any {
    const module = this.createShaderModule(source, label);
    if (typeof module?.getCompilationInfo === 'function') {
      void module.getCompilationInfo().then((info: any) => {
        const messages = Array.isArray(info?.messages) ? info.messages : [];
        for (const msg of messages) {
          const type = msg?.type ?? 'info';
          const text = msg?.message ?? String(msg);
          if (type === 'error') console.error(`[WGSL:${label ?? 'shader'}] ${text}`);
          else if (type === 'warning') console.warn(`[WGSL:${label ?? 'shader'}] ${text}`);
        }
      }).catch(() => {});
    }
    return module;
  }

  createRenderPipeline(descriptor: Record<string, any>, key?: string): any {
    const cacheKey = pipelineKey('render', descriptor, key);
    const cached = this.renderPipelines.get(cacheKey);
    if (cached) {
      this.renderPipelineCacheHits++;
      return cached;
    }
    const pipeline = this.device.createRenderPipeline(descriptor);
    this.renderPipelines.set(cacheKey, pipeline);
    this.renderPipelinesCreated++;
    return pipeline;
  }

  createComputePipeline(descriptor: Record<string, any>, key?: string): any {
    const cacheKey = pipelineKey('compute', descriptor, key);
    const cached = this.computePipelines.get(cacheKey);
    if (cached) {
      this.computePipelineCacheHits++;
      return cached;
    }
    const pipeline = this.device.createComputePipeline(descriptor);
    this.computePipelines.set(cacheKey, pipeline);
    this.computePipelinesCreated++;
    return pipeline;
  }

  warmRenderPipeline(descriptor: Record<string, any>, key?: string): Promise<any> {
    const cacheKey = pipelineKey('render', descriptor, key);
    const cached = this.renderPipelines.get(cacheKey);
    if (cached) {
      this.renderPipelineCacheHits++;
      return Promise.resolve(cached);
    }
    const pending = this.pendingRenderPipelineWarmups.get(cacheKey);
    if (pending) {
      this.renderPipelineCacheHits++;
      return pending;
    }
    this.renderPipelineWarmups++;
    const createAsync = typeof this.device.createRenderPipelineAsync === 'function'
      ? this.device.createRenderPipelineAsync.bind(this.device)
      : (desc: Record<string, any>) => Promise.resolve(this.device.createRenderPipeline(desc));
    const promise = Promise.resolve(createAsync(descriptor))
      .then((pipeline) => {
        this.pendingRenderPipelineWarmups.delete(cacheKey);
        this.renderPipelines.set(cacheKey, pipeline);
        this.renderPipelinesCreated++;
        return pipeline;
      })
      .catch((err) => {
        this.pendingRenderPipelineWarmups.delete(cacheKey);
        throw err;
      });
    this.pendingRenderPipelineWarmups.set(cacheKey, promise);
    return promise;
  }

  warmComputePipeline(descriptor: Record<string, any>, key?: string): Promise<any> {
    const cacheKey = pipelineKey('compute', descriptor, key);
    const cached = this.computePipelines.get(cacheKey);
    if (cached) {
      this.computePipelineCacheHits++;
      return Promise.resolve(cached);
    }
    const pending = this.pendingComputePipelineWarmups.get(cacheKey);
    if (pending) {
      this.computePipelineCacheHits++;
      return pending;
    }
    this.computePipelineWarmups++;
    const createAsync = typeof this.device.createComputePipelineAsync === 'function'
      ? this.device.createComputePipelineAsync.bind(this.device)
      : (desc: Record<string, any>) => Promise.resolve(this.device.createComputePipeline(desc));
    const promise = Promise.resolve(createAsync(descriptor))
      .then((pipeline) => {
        this.pendingComputePipelineWarmups.delete(cacheKey);
        this.computePipelines.set(cacheKey, pipeline);
        this.computePipelinesCreated++;
        return pipeline;
      })
      .catch((err) => {
        this.pendingComputePipelineWarmups.delete(cacheKey);
        throw err;
      });
    this.pendingComputePipelineWarmups.set(cacheKey, promise);
    return promise;
  }

  stats(): GhostGpuRuntimeStats {
    return {
      shaderModulesCreated: this.shaderModulesCreated,
      shaderModuleCacheHits: this.shaderModuleCacheHits,
      renderPipelinesCreated: this.renderPipelinesCreated,
      renderPipelineCacheHits: this.renderPipelineCacheHits,
      renderPipelineWarmups: this.renderPipelineWarmups,
      computePipelinesCreated: this.computePipelinesCreated,
      computePipelineCacheHits: this.computePipelineCacheHits,
      computePipelineWarmups: this.computePipelineWarmups,
      pendingPipelineWarmups: this.pendingRenderPipelineWarmups.size + this.pendingComputePipelineWarmups.size,
      ...this.resources.stats(),
    };
  }

  dispose(): void {
    this.shaderModules.clear();
    this.renderPipelines.clear();
    this.computePipelines.clear();
    this.pendingRenderPipelineWarmups.clear();
    this.pendingComputePipelineWarmups.clear();
    this.resources.dispose();
  }
}

export function isGhostGpuRuntime(value: any): value is GhostGpuRuntime {
  return !!value
    && typeof value === 'object'
    && typeof value.createShaderModule === 'function'
    && typeof value.warmShaderModule === 'function'
    && typeof value.createRenderPipeline === 'function'
    && typeof value.createComputePipeline === 'function'
    && typeof value.warmRenderPipeline === 'function'
    && typeof value.warmComputePipeline === 'function'
    && typeof value.stats === 'function'
    && !!value.resources;
}
