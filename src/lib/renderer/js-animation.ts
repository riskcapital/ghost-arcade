/**
 * JavaScript Animation Renderer
 * Handles rendering of AI-generated or custom Three.js and p5.js animations
 * by creating iframes from HTML code and capturing to texture
 */

import * as THREE from 'three';
import type { JSAnimationSource } from '../types';

export interface JSAnimationContext {
  id: string;
  iframe: HTMLIFrameElement;
  canvas: HTMLCanvasElement;
  texture: THREE.Texture;
  animationType: 'threejs' | 'p5js';
  updateTexture: () => void;
  updateParams: (params: Record<string, number | boolean | number[]>) => void;
  dispose: () => void;
}

const jsAnimationCache = new Map<string, JSAnimationContext>();

/**
 * Create a JS animation context from HTML code
 */
export function createJSAnimationContext(
  id: string,
  jsAnimation: JSAnimationSource,
  width = 1920,
  height = 1080
): JSAnimationContext {
  // Check cache first
  const cached = jsAnimationCache.get(id);
  if (cached) {
    return cached;
  }

  // Create hidden iframe
  const iframe = document.createElement('iframe');
  iframe.style.cssText = `
    position: fixed;
    left: -9999px;
    top: -9999px;
    width: ${width}px;
    height: ${height}px;
    border: none;
    pointer-events: none;
  `;

  // Create blob URL from HTML code
  const blob = new Blob([jsAnimation.htmlCode], { type: 'text/html' });
  const blobUrl = URL.createObjectURL(blob);
  iframe.src = blobUrl;

  document.body.appendChild(iframe);

  // Create offscreen canvas for texture capture
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  // Create Three.js texture from canvas
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.colorSpace = THREE.SRGBColorSpace;

  // Update texture from iframe canvas
  const updateTexture = () => {
    if (!ctx) return;

    try {
      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!iframeDoc) return;

      const iframeCanvas = iframeDoc.querySelector('canvas');
      if (iframeCanvas) {
        ctx.drawImage(iframeCanvas, 0, 0, width, height);
        texture.needsUpdate = true;
      }
    } catch (e) {
      // Cross-origin or not ready yet - ignore
    }
  };

  // Update animation parameters via window.shaderParams
  const updateParams = (params: Record<string, number | boolean | number[]>) => {
    try {
      const iframeWindow = iframe.contentWindow as Window & { shaderParams?: Record<string, unknown> };
      if (iframeWindow?.shaderParams) {
        Object.assign(iframeWindow.shaderParams, params);
      }
    } catch (e) {
      // Cross-origin - ignore
    }
  };

  // Cleanup function
  const dispose = () => {
    texture.dispose();
    iframe.remove();
    URL.revokeObjectURL(blobUrl);
    jsAnimationCache.delete(id);
  };

  const context: JSAnimationContext = {
    id,
    iframe,
    canvas,
    texture,
    animationType: jsAnimation.animationType,
    updateTexture,
    updateParams,
    dispose
  };

  jsAnimationCache.set(id, context);
  return context;
}

/**
 * Get an existing JS animation context
 */
export function getJSAnimationContext(id: string): JSAnimationContext | undefined {
  return jsAnimationCache.get(id);
}

/**
 * Dispose a JS animation context
 */
export function disposeJSAnimationContext(id: string): void {
  const context = jsAnimationCache.get(id);
  if (context) {
    context.dispose();
  }
}

/**
 * Update all active JS animation textures
 */
export function updateAllJSAnimationTextures(): void {
  const contexts = Array.from(jsAnimationCache.values());
  for (const context of contexts) {
    context.updateTexture();
  }
}

/**
 * Update parameters for a specific animation
 */
export function updateJSAnimationParams(id: string, params: Record<string, number | boolean | number[]>): void {
  const context = jsAnimationCache.get(id);
  if (context) {
    context.updateParams(params);
  }
}

/**
 * Get all active JS animation IDs
 */
export function getActiveJSAnimationIds(): string[] {
  return Array.from(jsAnimationCache.keys());
}

/**
 * Check if a JS animation context exists
 */
export function hasJSAnimationContext(id: string): boolean {
  return jsAnimationCache.has(id);
}

/**
 * Dispose all JS animation contexts
 */
export function disposeAllJSAnimationContexts(): void {
  const ids = Array.from(jsAnimationCache.keys());
  for (const id of ids) {
    disposeJSAnimationContext(id);
  }
}
