import { WGSL_STDLIB } from './modules';
import { resolveWgslIncludes } from './resolveIncludes';
import { isGhostGpuRuntime } from '../gpuRuntime';

export function resolveGhostWgsl(source: string, sourceName = 'inline'): string {
  return resolveWgslIncludes(source, {
    modules: WGSL_STDLIB,
    sourceName,
  });
}

export function createWgslShaderModule(deviceOrRuntime: any, source: string, label?: string): any {
  if (isGhostGpuRuntime(deviceOrRuntime)) {
    return deviceOrRuntime.createShaderModule(source, label);
  }
  const descriptor: Record<string, any> = {
    code: resolveGhostWgsl(source, label ?? 'shader'),
  };
  if (label) descriptor.label = label;
  return deviceOrRuntime.createShaderModule(descriptor);
}

export function createAndWarmWgslShaderModule(deviceOrRuntime: any, source: string, label?: string): any {
  if (isGhostGpuRuntime(deviceOrRuntime)) {
    return deviceOrRuntime.warmShaderModule(source, label);
  }
  const module = createWgslShaderModule(deviceOrRuntime, source, label);
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
