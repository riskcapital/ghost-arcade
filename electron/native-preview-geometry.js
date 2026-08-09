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
