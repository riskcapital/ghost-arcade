import { describe, expect, it } from 'vitest';
import { resolveGhostWgsl } from './shaderModule';
import { extractWgslModuleUses, extractWgslSources } from './sourceAudit';

const rendererSourceFiles = import.meta.glob([
  '../**/*.ts',
  '!../**/*.test.ts',
], {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Record<string, string>;

function rendererRecords() {
  return Object.entries(rendererSourceFiles)
    .flatMap(([file, source]) => extractWgslSources(file, source));
}

describe('WGSL source audit', () => {
  it('discovers the renderer shader inventory', () => {
    const records = rendererRecords();

    expect(records.length).toBeGreaterThanOrEqual(30);
    expect(records.some((record) => record.name === 'SHADER_SWITCH_BLEND_WGSL')).toBe(true);
    expect(records.some((record) => record.name === 'PLANET_WGSL')).toBe(true);
  });

  it('resolves stdlib includes for every tagged shader source', () => {
    const failures: string[] = [];

    for (const record of rendererRecords()) {
      try {
        resolveGhostWgsl(record.source, `${record.file}:${record.name}`);
      } catch (err: any) {
        failures.push(`${record.file}:${record.name}: ${err?.message ?? err}`);
      }
    }

    expect(failures).toEqual([]);
  });

  it('keeps shader-module creation on tagged WGSL constants', () => {
    const failures: string[] = [];
    for (const [file, source] of Object.entries(rendererSourceFiles)) {
      if (file.endsWith('/wgsl/shaderModule.ts') || file === './shaderModule.ts') continue;
      for (const use of extractWgslModuleUses(file, source)) {
        if (!/^[A-Za-z0-9_]*WGSL$/.test(use.sourceArg)) {
          failures.push(`${use.file}:${use.line} uses ${use.sourceArg || '<missing>'}`);
        }
      }
    }

    expect(failures).toEqual([]);
  });
});
