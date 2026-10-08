import type { WLEDNormalizedPoint, WLEDSourceRegion } from '../types';
import { blue } from '../theming/blueScale';

export interface LEDMapPreviewOptions {
  /** Resolved points in physical LED order, normalized to the composite. */
  points: WLEDNormalizedPoint[];
  sourceRegion: WLEDSourceRegion;
  selectedPoint?: number;
  /** Optional live RGB triples in the same order as `points`. */
  colors?: Uint8Array;
  /** Other fixtures' points, drawn faintly for context. */
  others?: WLEDNormalizedPoint[][];
}

/** Draw an LED map preview: source region, wiring path and numbered points.
 *  Shared by the WLED and Art-Net / sACN panels. */
export function drawLEDMapPreview(canvas: HTMLCanvasElement, options: LEDMapPreviewOptions): void {
  const { points, sourceRegion: region, selectedPoint = -1, colors, others = [] } = options;
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const cssWidth = Math.max(1, rect.width);
  const cssHeight = Math.max(1, rect.height);
  const pixelWidth = Math.round(cssWidth * dpr);
  const pixelHeight = Math.round(cssHeight * dpr);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const context = canvas.getContext('2d');
  if (!context) return;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, cssWidth, cssHeight);

  const gradient = context.createLinearGradient(0, 0, cssWidth, cssHeight);
  gradient.addColorStop(0, blue('mute-800'));
  gradient.addColorStop(0.5, '#101116');
  gradient.addColorStop(1, '#251423');
  context.fillStyle = gradient;
  context.fillRect(0, 0, cssWidth, cssHeight);

  context.strokeStyle = 'rgba(255,255,255,0.07)';
  context.lineWidth = 1;
  for (let column = 1; column < 8; column += 1) {
    const x = cssWidth * column / 8;
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, cssHeight);
    context.stroke();
  }
  for (let row = 1; row < 4; row += 1) {
    const y = cssHeight * row / 4;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(cssWidth, y);
    context.stroke();
  }

  context.fillStyle = 'rgba(255,255,255,0.18)';
  for (const group of others) {
    for (const point of group) {
      context.fillRect(point.x * cssWidth - 1, point.y * cssHeight - 1, 2, 2);
    }
  }

  context.fillStyle = blue(400, 0.08);
  context.fillRect(region.x * cssWidth, region.y * cssHeight, region.width * cssWidth, region.height * cssHeight);
  context.strokeStyle = blue(300);
  context.setLineDash([5, 4]);
  context.strokeRect(
    region.x * cssWidth + 0.5,
    region.y * cssHeight + 0.5,
    region.width * cssWidth - 1,
    region.height * cssHeight - 1
  );
  context.setLineDash([]);

  if (points.length > 1) {
    context.strokeStyle = 'rgba(187,134,252,0.48)';
    context.lineWidth = 1.5;
    context.beginPath();
    points.forEach((point, index) => {
      const x = point.x * cssWidth;
      const y = point.y * cssHeight;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.stroke();
  }

  const pointRadius = points.length > 160 ? 2 : points.length > 64 ? 3 : 4;
  points.forEach((point, index) => {
    const x = point.x * cssWidth;
    const y = point.y * cssHeight;
    context.beginPath();
    context.arc(x, y, index === selectedPoint ? pointRadius + 3 : pointRadius, 0, Math.PI * 2);
    if (index === selectedPoint) {
      context.fillStyle = '#fff';
    } else if (colors && colors.length >= index * 3 + 3) {
      context.fillStyle = `rgb(${colors[index * 3]},${colors[index * 3 + 1]},${colors[index * 3 + 2]})`;
    } else {
      context.fillStyle = index === 0 ? '#ff8577' : '#bb86fc';
    }
    context.fill();
    if (colors && index === 0 && index !== selectedPoint) {
      context.strokeStyle = '#ff8577';
      context.lineWidth = 1.5;
      context.stroke();
    }
    if (index === selectedPoint || (points.length <= 64 && index % 8 === 0)) {
      context.font = '10px ui-monospace, monospace';
      context.fillStyle = index === selectedPoint ? '#fff' : '#9a8ba8';
      context.fillText(String(index + 1), x + 7, y - 6);
    }
  });
}
