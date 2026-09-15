function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positiveDimension(value, fallback) {
  return Math.max(1, finiteNumber(value, fallback));
}

export function normalizeNativePreviewRect(rect = {}, generation = 0) {
  const width = positiveDimension(rect.width, 1);
  const height = positiveDimension(rect.height, 1);
  return {
    x: finiteNumber(rect.x, 0),
    y: finiteNumber(rect.y, 0),
    width,
    height,
    contentX: finiteNumber(rect.contentX, 0),
    contentY: finiteNumber(rect.contentY, 0),
    contentWidth: positiveDimension(rect.contentWidth, width),
    contentHeight: positiveDimension(rect.contentHeight, height),
    generation: Math.max(0, Math.trunc(finiteNumber(generation || rect.generation, 0))),
  };
}

/**
 * The editor sends the preview rectangle in CSS pixels. The macOS presenter
 * works in AppKit points, which CSS pixels already are. The Windows presenter
 * does not: its window and swapchain cover the host's client area in physical
 * pixels, and it used the CSS rectangle as its viewport as-is. That lined up
 * only while the app forced a device scale factor of 1, which 2.0.5 stopped
 * doing so the UI would follow Windows display scaling. At 150% the preview
 * was drawn at two thirds of its size, up and to the left of the canvas, so
 * the picture no longer sat under its warp box.
 *
 * Edges are rounded rather than sizes, so a rectangle and its neighbours
 * still meet without a gap.
 */
export function nativePreviewRectToDevicePixels(rect, pixelRatio) {
  const ratio = Number(pixelRatio);
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio === 1) return rect;
  const edge = (value) => Math.round(value * ratio);
  const x = edge(rect.x);
  const y = edge(rect.y);
  const contentX = edge(rect.contentX);
  const contentY = edge(rect.contentY);
  return {
    ...rect,
    x,
    y,
    width: Math.max(1, edge(rect.x + rect.width) - x),
    height: Math.max(1, edge(rect.y + rect.height) - y),
    contentX,
    contentY,
    contentWidth: Math.max(1, edge(rect.contentX + rect.contentWidth) - contentX),
    contentHeight: Math.max(1, edge(rect.contentY + rect.contentHeight) - contentY),
  };
}

export function nativePreviewRectSignature(rect) {
  const values = [
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    rect.contentX,
    rect.contentY,
    rect.contentWidth,
    rect.contentHeight,
  ];
  return values.map(value => Number(value).toFixed(3)).join(',');
}

export function nativePreviewGeometryMatches(rect, status, tolerance = 0.75) {
  if (!status?.attached) return false;
  if (Number(status.geometryGeneration) !== Number(rect.generation)) return false;
  const pairs = [
    [status.viewX, rect.x],
    [status.viewY, rect.y],
    [status.viewWidth, rect.width],
    [status.viewHeight, rect.height],
    [status.contentX, rect.contentX],
    [status.contentY, rect.contentY],
    [status.contentWidth, rect.contentWidth],
    [status.contentHeight, rect.contentHeight],
  ];
  return pairs.every(([actual, expected]) => (
    Number.isFinite(Number(actual)) &&
    Math.abs(Number(actual) - Number(expected)) <= tolerance
  ));
}
