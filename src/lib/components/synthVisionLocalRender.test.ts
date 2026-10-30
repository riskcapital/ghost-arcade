import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Performer's picture comes from the native engine. Its hidden canvases are
 * a local copy nothing reads, so the GL contexts, buffers and per-frame
 * drawing behind them must only start once a caller asks for the canvas.
 */
const source = readFileSync(join(process.cwd(), 'src', 'lib', 'components', 'SynthVision.svelte'), 'utf8');
const between = (from: string, to: string) => source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from)));

describe('Performer local render', () => {
  it('sets up its GL pipeline only from startLocalRender', () => {
    const start = between('function startLocalRender()', '/** The local composite');
    expect(start).toContain('initShaders();');
    expect(start).toContain('initThree();');
    expect(start).toContain("outputCanvas.getContext('2d'");
    const outside = source.replace(start, '');
    expect(outside).not.toMatch(/^\s*initShaders\(\);/m);
    expect(outside).not.toMatch(/^\s*initThree\(\);/m);
    expect(outside).not.toContain("compCtx = outputCanvas.getContext('2d'");
    // The camera effect pass is only built for the local copy.
    expect(between('async function startCamera()', 'function stopCamera()')).toContain('!camGl && localRenderActive');
  });

  it('keeps the store updates but stops before any local drawing', () => {
    const frame = between('function renderFrame(now: number)', '// Composite to output canvas');
    const gate = frame.indexOf('if (!localRenderActive) return;');
    expect(gate).toBeGreaterThan(0);
    for (const kept of ['synthVisionStore.update(', 'synthVisionStore.decayEffects(dt)', 'updateAudio()', 'detectMotion()']) {
      expect(frame.indexOf(kept), kept).toBeGreaterThan(0);
      expect(frame.indexOf(kept), kept).toBeLessThan(gate);
    }
    for (const drawn of ['ensureFBO()', 'updateWorld(dt)', 'camGl.drawArrays', 'composer.render()']) {
      expect(frame.indexOf(drawn), drawn).toBeGreaterThan(gate);
    }
  });

  it('leaves the canvases at their default size until then', () => {
    const resize = between('function handleResize()', 'outputCanvas.width = w');
    expect(resize).toContain('if (!localRenderActive) return;');
  });
});
