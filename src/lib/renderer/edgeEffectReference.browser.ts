// Test-only: renders Edge Effects with the editor's WebGL DrawingRenderer,
// the reference the native core is compared against. Bundled by
// edgeEffects.native.test.ts and run in an offscreen Electron window.
//
// Each effect is drawn exactly as RenderEngine.renderLayerEdgeEffects draws
// it (same outline, same normalized style, additive blend into a cleared
// 8-bit target), at a fixed clock. The result per effect is the target's
// premultiplied RGBA, rows top-down.

import * as THREE from 'three';
import type { EdgeEffect, Layer } from '../types';
import { DrawingRenderer } from '../drawing/renderer';
import { createDefaultShapeMesh, createDefaultShapeWarp, type DrawingElement, type PointClickLineShape } from '../drawing/types';
import { DEFAULT_DRAWING_STYLE } from '../drawing/drawingStyle';
import { edgeEffectOutline, normalizeEdgeEffectStyle } from '../drawing/edgeEffects';

export interface EdgeReferenceCase {
  id: string;
  width: number;
  height: number;
  time: number;
  layer: Pick<Layer, 'layerShape' | 'corners' | 'warpMode' | 'meshGrid'>;
  effects: EdgeEffect[];
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function renderEdgeEffectReferences(cases: EdgeReferenceCase[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, premultipliedAlpha: false, antialias: false, preserveDrawingBuffer: true });
  for (const testCase of cases) {
    const { width, height } = testCase;
    renderer.setSize(width, height, false);
    const drawing = new DrawingRenderer(renderer, width, height);
    const target = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
    });
    const vertices = edgeEffectOutline(testCase.layer, width, height);
    const images: string[] = [];
    for (const effect of testCase.effects) {
      const style = normalizeEdgeEffectStyle(effect, 'webgl');
      const element: DrawingElement = {
        id: effect.id,
        name: 'edge-effect',
        shape: {
          id: 'edge-temp', type: 'pointClickLine', visible: true, locked: false,
          position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 }, zIndex: 0,
          points: vertices, closed: true, cornerStyle: 'sharp',
        } as PointClickLineShape,
        fill: style.fill,
        stroke: style.stroke,
        animation: style.animation,
        warpCorners: createDefaultShapeWarp(),
        warpEnabled: false,
        meshWarp: createDefaultShapeMesh(),
        meshWarpEnabled: false,
        shadowEnabled: false,
        blendMode: 'normal',
        opacity: 1,
      } as DrawingElement;
      drawing.renderElements([element], target, { timeSeconds: testCase.time, styleBase: DEFAULT_DRAWING_STYLE });
      const pixels = new Uint8Array(width * height * 4);
      renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
      const flipped = new Uint8Array(pixels.length);
      const row = width * 4;
      for (let y = 0; y < height; y++) flipped.set(pixels.subarray(y * row, y * row + row), (height - 1 - y) * row);
      images.push(toBase64(flipped));
    }
    target.dispose();
    drawing.dispose();
    out[testCase.id] = images;
  }
  renderer.dispose();
  return out;
}
