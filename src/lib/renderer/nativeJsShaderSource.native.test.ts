import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { JSAnimationSource } from '$lib/types';
import {
  extractJavascriptFragmentShader,
  nativeShaderSourceFromJavascript,
} from './nativeJsShaderSource';

const embryoHtml = readFileSync(
  new URL('../../../public/threejs/embryo/index.html', import.meta.url),
  'utf8',
);

const embryoSource: JSAnimationSource = {
  animationType: 'threejs',
  htmlCode: embryoHtml,
  params: [
    { name: 'speed', type: 'number', default: 1, min: 0, max: 3 },
    { name: 'cameraDistance', type: 'number', default: 8, min: 4, max: 16 },
    { name: 'fov', type: 'number', default: 1.6, min: 0.6, max: 2.6 },
    { name: 'particleGlow', type: 'number', default: 1, min: 0, max: 3 },
    { name: 'lineGlow', type: 'number', default: 1, min: 0, max: 3 },
    { name: 'nucleusIntensity', type: 'number', default: 1, min: 0, max: 3 },
    { name: 'vignette', type: 'number', default: 0.35, min: 0, max: 1 },
    { name: 'electronColor', type: 'color', default: [0.4, 0.7, 1] },
  ],
  paramValues: {
    speed: 1.25,
    cameraDistance: 9,
    electronColor: [0.2, 0.8, 1],
  },
};

describe('native JavaScript shader source', () => {
  it('extracts the bundled shader-backed JavaScript visual', () => {
    const fragment = extractJavascriptFragmentShader(embryoHtml);
    expect(fragment).toContain('void main()');
    expect(fragment).toContain('uniform float uCamDist;');
  });

  it('converts time, resolution, and JavaScript controls into the native ISF contract', () => {
    const native = nativeShaderSourceFromJavascript(embryoSource);
    expect(native).not.toBeNull();
    expect(native!.shaderCode).toContain('"ISFVSN":"2"');
    expect(native!.shaderCode).toContain('(TIME * speed)');
    expect(native!.shaderCode).toContain('RENDERSIZE');
    expect(native!.shaderCode).toContain('cameraDistance');
    expect(native!.shaderCode).toContain('electronColor.rgb');
    expect(native!.shaderCode).toContain('vec3 r;');
    expect(native!.shaderCode).not.toContain('RENDERSIZE.r');
    expect(native!.shaderCode).not.toContain('uniform float t;');
    expect(native!.shaderCode).not.toContain('uniform float uCamDist;');
    expect(native!.shaderValues.speed).toBe(1.25);
    expect(native!.shaderValues.cameraDistance).toBe(9);
  });

  it('does not pretend arbitrary canvas JavaScript is native-renderable', () => {
    expect(nativeShaderSourceFromJavascript({
      animationType: 'p5js',
      htmlCode: '<script>function draw(){ circle(20, 20, 10); }</script>',
    })).toBeNull();
  });
});
