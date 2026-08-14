import { describe, it, beforeAll } from 'vitest';

let effectToNativeDescriptor: any;
let nativeEffectPassFromDescriptor: any;
let packNativeEffectPassUniforms: any;
let effectParamLabels: any;

beforeAll(async () => {
  const storage = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, String(v)),
    removeItem: (k: string) => void storage.delete(k),
    clear: () => storage.clear(), key: () => null, length: 0,
  };
  (globalThis as any).document = {
    createElement: () => ({ getContext: () => null, style: {}, remove: () => {} }),
    documentElement: { style: { setProperty: () => {} }, setAttribute: () => {}, getAttribute: () => null },
    addEventListener: () => {}, removeEventListener: () => {},
    body: { appendChild: () => {}, removeChild: () => {} },
    baseURI: 'http://localhost/',
  };
  (globalThis as any).window = Object.assign((globalThis as any).window ?? {}, {
    addEventListener: () => {}, removeEventListener: () => {},
    setInterval, clearInterval, setTimeout, clearTimeout,
  });
  const sync = await import('../sync/nativeRendererSync');
  const pass = await import('./nativeEffectPass');
  const ux = await import('../effects/effectUX');
  effectToNativeDescriptor = sync.effectToNativeDescriptor;
  nativeEffectPassFromDescriptor = sync.nativeEffectPassFromDescriptor;
  packNativeEffectPassUniforms = pass.packNativeEffectPassUniforms;
  effectParamLabels = ux.effectParamLabels;
});

function pack(type: string, params: Record<string, number>): string | null {
  const descriptor = effectToNativeDescriptor({ id: 'e1', type, enabled: true, params });
  if (!descriptor) return null;
  const runtime = nativeEffectPassFromDescriptor(descriptor);
  if (!runtime) return `DESCRIPTOR_ONLY:${descriptor}`;
  const packed = packNativeEffectPassUniforms({
    effect: runtime.effect, amount: runtime.amount, mix: 1,
    // audioLevel mirrors the per-frame graph rebuild, which injects the live
    // level so audio-reactive knobs (phase-lab, plasma) fold against a real
    // signal. Without it those params pack to zero and read as false dead.
    params: { audioLevel: 0.6, ...(runtime.params ?? {}) },
    width: 1920, height: 1080, time: 1, frameDelta: 1 / 60, frameIndex: 10,
  });
  return JSON.stringify(packed);
}

describe('comprehensive effect param audit', () => {
  it('finds every dead UI param', async () => {
    const deadByEffect: Record<string, string[]> = {};
    const routeless: string[] = [];
    let liveParams = 0;
    let deadParams = 0;
    for (const [type, defs] of Object.entries(effectParamLabels as Record<string, Record<string, any>>)) {
      const paramDefs = Object.entries(defs).filter(([, d]: any) =>
        typeof d?.min === 'number' && typeof d?.max === 'number');
      if (!paramDefs.length) continue;
      const defaults: Record<string, number> = {};
      for (const [key, d] of paramDefs as any) defaults[key] = d.default ?? d.min;
      const base = pack(type, defaults);
      if (base === null) { routeless.push(type); continue; }
      for (const [key, d] of paramDefs as any) {
        // Midpoint shift first, not max: cyclic params (angles, phases) wrap
        // at their max (360 -> 0) and read as false dead at the extremes.
        // Then min and max as fallbacks — a binary toggle's midpoint rounds
        // back to its own default and would otherwise read as false dead.
        const mid = (d.min + d.max) / 2;
        const candidates = [
          Math.abs(defaults[key] - mid) > (d.max - d.min) * 0.05
            ? mid
            : d.min + (d.max - d.min) * 0.75,
          d.min,
          d.max,
        ];
        const live = candidates.some((target) =>
          target !== defaults[key] && pack(type, { ...defaults, [key]: target }) !== base);
        if (live) liveParams++;
        else { (deadByEffect[type] ??= []).push(key); deadParams++; }
      }
    }
    const lines: string[] = [];
    lines.push(`LIVE params: ${liveParams}   DEAD params: ${deadParams}`);
    lines.push(`no native descriptor at all (${routeless.length}): ${routeless.join(', ')}`);
    lines.push(`DEAD PARAMS BY EFFECT (${Object.keys(deadByEffect).length} effects):`);
    for (const [type, keys] of Object.entries(deadByEffect).sort()) {
      lines.push(`  ${type}: ${keys.join(', ')}`);
    }
    const fs = await import('node:fs');
    fs.writeFileSync('/tmp/param-audit-report.txt', lines.join('\n'));
    console.log(lines.join('\n'));
  });
});
