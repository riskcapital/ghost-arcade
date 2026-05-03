/**
 * Test pattern generator for projector alignment and calibration.
 * Draws directly to a 2D canvas context.
 */

export type TestPatternType = 'none' | 'grid' | 'crosshair' | 'color-bars' | 'white' | 'gradient' | 'checkerboard';

export const TEST_PATTERN_OPTIONS: { value: TestPatternType; label: string }[] = [
  { value: 'none', label: 'Off' },
  { value: 'grid', label: 'Alignment Grid' },
  { value: 'crosshair', label: 'Center Crosshair' },
  { value: 'color-bars', label: 'SMPTE Color Bars' },
  { value: 'white', label: 'Full White' },
  { value: 'gradient', label: 'Gray Gradient' },
  { value: 'checkerboard', label: 'Checkerboard' },
];

/**
 * Draw a test pattern onto a canvas.
 * Returns true if a pattern was drawn, false if pattern is 'none'.
 */
export function drawTestPattern(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  pattern: TestPatternType
): boolean {
  if (pattern === 'none') return false;

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);

  switch (pattern) {
    case 'grid':
      drawGrid(ctx, width, height);
      break;
    case 'crosshair':
      drawCrosshair(ctx, width, height);
      break;
    case 'color-bars':
      drawColorBars(ctx, width, height);
      break;
    case 'white':
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, width, height);
      break;
    case 'gradient':
      drawGradient(ctx, width, height);
      break;
    case 'checkerboard':
      drawCheckerboard(ctx, width, height);
      break;
  }

  // Draw resolution label in corner
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.font = `${Math.max(14, height / 50)}px monospace`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(`${width}×${height}`, 10, 10);

  return true;
}

function drawGrid(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  w: number,
  h: number
) {
  const gridSize = Math.max(w, h) / 16;

  // Grid lines
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = gridSize; x < w; x += gridSize) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
  }
  for (let y = gridSize; y < h; y += gridSize) {
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  ctx.stroke();

  // Border
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.strokeRect(2, 2, w - 4, h - 4);

  // Center cross
  ctx.strokeStyle = '#f00';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(w / 2, 0);
  ctx.lineTo(w / 2, h);
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.stroke();

  // Center circle
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, Math.min(w, h) / 8, 0, Math.PI * 2);
  ctx.stroke();

  // Corner markers
  const markerSize = gridSize * 2;
  ctx.strokeStyle = '#0f0';
  ctx.lineWidth = 2;
  const corners = [
    [0, 0], [w, 0], [0, h], [w, h]
  ];
  for (const [cx, cy] of corners) {
    const sx = cx === 0 ? 1 : -1;
    const sy = cy === 0 ? 1 : -1;
    ctx.beginPath();
    ctx.moveTo(cx + sx * markerSize, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy + sy * markerSize);
    ctx.stroke();
  }

  // Safe area (90%)
  ctx.strokeStyle = 'rgba(0, 128, 255, 0.4)';
  ctx.lineWidth = 1;
  ctx.setLineDash([8, 4]);
  const safeX = w * 0.05;
  const safeY = h * 0.05;
  ctx.strokeRect(safeX, safeY, w * 0.9, h * 0.9);
  ctx.setLineDash([]);
}

function drawCrosshair(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  w: number,
  h: number
) {
  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.min(w, h) * 0.35;

  // Crosshair lines
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx, 0);
  ctx.lineTo(cx, h);
  ctx.moveTo(0, cy);
  ctx.lineTo(w, cy);
  ctx.stroke();

  // Concentric circles
  ctx.strokeStyle = '#888';
  for (let r = radius; r > 10; r -= radius / 5) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Center dot
  ctx.fillStyle = '#f00';
  ctx.beginPath();
  ctx.arc(cx, cy, 4, 0, Math.PI * 2);
  ctx.fill();

  // Border
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, w - 2, h - 2);
}

function drawColorBars(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  w: number,
  h: number
) {
  // SMPTE-style color bars
  const colors = ['#fff', '#ff0', '#0ff', '#0f0', '#f0f', '#f00', '#00f', '#000'];
  const barW = w / colors.length;
  const topH = h * 0.67;

  // Top bars (75% white)
  for (let i = 0; i < colors.length; i++) {
    ctx.fillStyle = colors[i];
    ctx.fillRect(i * barW, 0, barW + 1, topH);
  }

  // Middle section — reverse order subset
  const midColors = ['#00f', '#000', '#f0f', '#000', '#0ff', '#000', '#fff'];
  const midBarW = w / midColors.length;
  const midH = h * 0.08;
  for (let i = 0; i < midColors.length; i++) {
    ctx.fillStyle = midColors[i];
    ctx.fillRect(i * midBarW, topH, midBarW + 1, midH);
  }

  // Bottom — grayscale ramp
  const botY = topH + midH;
  const botH = h - botY;
  for (let x = 0; x < w; x++) {
    const v = Math.round((x / w) * 255);
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(x, botY, 1, botH);
  }
}

function drawGradient(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  w: number,
  h: number
) {
  // Horizontal gray gradient
  const gradient = ctx.createLinearGradient(0, 0, w, 0);
  gradient.addColorStop(0, '#000');
  gradient.addColorStop(1, '#fff');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h * 0.5);

  // Vertical gray gradient (bottom half)
  const vGrad = ctx.createLinearGradient(0, h * 0.5, 0, h);
  vGrad.addColorStop(0, '#000');
  vGrad.addColorStop(1, '#fff');
  ctx.fillStyle = vGrad;
  ctx.fillRect(0, h * 0.5, w, h * 0.5);

  // Step wedge (16 steps) across the middle
  const stepH = h * 0.1;
  const stepY = h * 0.45;
  const steps = 16;
  const stepW = w / steps;
  for (let i = 0; i < steps; i++) {
    const v = Math.round((i / (steps - 1)) * 255);
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(i * stepW, stepY, stepW + 1, stepH);
  }
}

function drawCheckerboard(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  w: number,
  h: number
) {
  const tileSize = Math.max(w, h) / 32;
  for (let y = 0; y < h; y += tileSize) {
    for (let x = 0; x < w; x += tileSize) {
      const isWhite = ((Math.floor(x / tileSize) + Math.floor(y / tileSize)) % 2) === 0;
      ctx.fillStyle = isWhite ? '#fff' : '#000';
      ctx.fillRect(x, y, tileSize, tileSize);
    }
  }
}
