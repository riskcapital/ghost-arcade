import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  nativePreviewGeometryMatches,
  nativePreviewRectSignature,
  nativePreviewRectToDevicePixels,
  normalizeNativePreviewRect,
} from '../../../electron/native-preview-geometry.js';

describe('native preview geometry contract', () => {
  it('preserves signed positions while clamping only dimensions', () => {
    expect(normalizeNativePreviewRect({
      x: -18.5,
      y: -4,
      width: 0,
      height: 720,
      contentX: -120,
      contentY: 24,
      contentWidth: 0,
      contentHeight: 640,
    }, 12)).toEqual({
      x: -18.5,
      y: -4,
      width: 1,
      height: 720,
      contentX: -120,
      contentY: 24,
      contentWidth: 1,
      contentHeight: 640,
      generation: 12,
    });
  });

  it('scales the rect to physical pixels for display scaling, edge-aligned', () => {
    const rect = normalizeNativePreviewRect({
      x: 353,
      y: 416,
      width: 594,
      height: 334,
      contentX: 10.5,
      contentY: 0,
      contentWidth: 573,
      contentHeight: 334,
    }, 3);
    // Windows at 150%: the canvas the warp box sits on starts at 529.5 and
    // ends at 1420.5 physical pixels.
    expect(nativePreviewRectToDevicePixels(rect, 1.5)).toEqual({
      x: 530,
      y: 624,
      width: 891,
      height: 501,
      contentX: 16,
      contentY: 0,
      contentWidth: 859,
      contentHeight: 501,
      generation: 3,
    });
    // 125% puts x on a half pixel: rounding each edge keeps the right edge
    // where rounding the size alone would drift it.
    const scaled = nativePreviewRectToDevicePixels(
      normalizeNativePreviewRect({ x: 101, y: 0, width: 101, height: 10 }),
      1.25,
    );
    expect(scaled.x + scaled.width).toBe(Math.round(202 * 1.25));
    // No scaling, or a ratio that makes no sense, leaves the rect alone.
    expect(nativePreviewRectToDevicePixels(rect, 1)).toBe(rect);
    expect(nativePreviewRectToDevicePixels(rect, 0)).toBe(rect);
    expect(nativePreviewRectToDevicePixels(rect, Number.NaN)).toBe(rect);
  });

  it('invalidates the signature when the canvas-owned rectangle changes', () => {
    const rect = normalizeNativePreviewRect({
      x: 350,
      y: 169,
      width: 951,
      height: 535,
      contentX: 0,
      contentY: 0,
      contentWidth: 951,
      contentHeight: 535,
    }, 7);
    expect(nativePreviewRectSignature({
      ...rect,
      width: 900,
      contentWidth: 900,
    })).not.toBe(nativePreviewRectSignature(rect));
  });

  it('accepts only the exact applied generation and frame', () => {
    const rect = normalizeNativePreviewRect({
      x: 350,
      y: 169,
      width: 951,
      height: 535,
      contentX: 0,
      contentY: 0,
      contentWidth: 951,
      contentHeight: 535,
    }, 21);
    const status = {
      attached: true,
      geometryGeneration: 21,
      viewX: 350,
      viewY: 169,
      viewWidth: 951,
      viewHeight: 535,
      contentX: 0,
      contentY: 0,
      contentWidth: 951,
      contentHeight: 535,
    };
    expect(nativePreviewGeometryMatches(rect, status)).toBe(true);
    expect(nativePreviewGeometryMatches(rect, {
      ...status,
      geometryGeneration: 20,
    })).toBe(false);
    expect(nativePreviewGeometryMatches(rect, {
      ...status,
      viewWidth: 900,
    })).toBe(false);
  });

  it('keeps the DOM canvas as the sole geometry and content owner', () => {
    const addonPath = fileURLToPath(new URL(
      '../../../electron/native/native_preview_addon.mm',
      import.meta.url,
    ));
    const source = readFileSync(addonPath, 'utf8').replace(/\r\n/g, '\n');
    const setFrameBody = source.match(
      /- \(void\)setFrame:\(NSRect\)frame \{([\s\S]*?)\n\}\n\n- \(void\)setContentRect:/,
    )?.[1] ?? '';

    expect(source).toContain('gPreviewView.autoresizingMask = NSViewNotSizable;');
    expect(source).not.toContain(
      'gPreviewView.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;',
    );
    expect(setFrameBody).toContain('contentRect_ = self.bounds;');
    expect(source).toContain(
      '[gPreviewView setContentRect:gPreviewView.bounds generation:rectValues.generation];',
    );
    expect(source).toContain(
      'NSView* coordinateView = gParentWebView;',
    );
    expect(source).toContain(
      'gPreviewView.frame = HostFrameFromWebClientRect(rectValues, coordinateView, hostView);',
    );
    expect(source).toContain(
      '[webView convertRect:webFrame toView:hostView]',
    );
    expect(source).toContain('if (parentWebView) gParentWebView = parentWebView;');
  });

  it('drives native presentation and DOM overlays from one geometry snapshot', () => {
    const canvasPath = fileURLToPath(new URL(
      '../components/Canvas.svelte',
      import.meta.url,
    ));
    const appPath = fileURLToPath(new URL('../../App.svelte', import.meta.url));
    const canvasSource = readFileSync(canvasPath, 'utf8').replace(/\r\n/g, '\n');
    const appSource = readFileSync(appPath, 'utf8');
    const embeddedRectBody = canvasSource.match(
      /function nativePreviewEmbeddedRect\(\):[\s\S]*?\n  \}\n\n  function scheduleNativePreviewWindowSync/,
    )?.[0] ?? '';

    expect(canvasSource).toContain('editorCanvasGeometry.set(editorCanvasGeometrySnapshot)');
    expect(embeddedRectBody).toContain('publishEditorCanvasGeometry()');
    expect(embeddedRectBody).toContain('geometry.clientX');
    expect(embeddedRectBody).toContain('geometry.clientWidth');
    expect(embeddedRectBody).toContain('contentX: 0');
    expect(embeddedRectBody).toContain('contentWidth: width');
    expect(appSource).toContain('$editorCanvasGeometry?.layoutWidth');
    expect(appSource).toContain('$editorCanvasGeometry?.layoutX');
    expect(appSource).not.toContain("querySelector('.canvas-container')");
    expect(appSource).not.toContain('measuredCanvasWidth');
  });
});
