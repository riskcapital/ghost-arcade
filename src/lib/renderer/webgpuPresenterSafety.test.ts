import { describe, expect, it } from 'vitest';
import webGPUCanvasSource from '../components/WebGPUCanvas.svelte?raw';

describe('WebGPU final presenter safety', () => {
  it('does not include hidden showcase overlays or performer-key toggles', () => {
    expect(webGPUCanvasSource).not.toContain('WebGPUPaintDrip');
    expect(webGPUCanvasSource).not.toContain('paintEnabled');
    expect(webGPUCanvasSource).not.toContain('paintDrip');
    expect(webGPUCanvasSource).not.toContain("e.key === 'd'");
  });
});
