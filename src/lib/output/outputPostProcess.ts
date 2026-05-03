/**
 * Output post-processing: edge blending, brightness/gamma/contrast.
 * Applied as a final 2D canvas pass on the output frame.
 *
 * Uses a 2D canvas approach for maximum compatibility (works on output.html too).
 */

export interface OutputPostProcessParams {
  blackout: boolean;
  brightness: number;     // 0-2, 1 = normal
  gamma: number;          // 0.2-5, 1 = normal
  contrast: number;       // 0-2, 1 = normal
  edgeBlendLeft: number;  // 0-0.5, fraction of width
  edgeBlendRight: number;
  edgeBlendTop: number;
  edgeBlendBottom: number;
  edgeBlendGamma: number; // Blend curve power
}

const DEFAULT_PARAMS: OutputPostProcessParams = {
  blackout: false,
  brightness: 1,
  gamma: 1,
  contrast: 1,
  edgeBlendLeft: 0,
  edgeBlendRight: 0,
  edgeBlendTop: 0,
  edgeBlendBottom: 0,
  edgeBlendGamma: 2.2,
};

/**
 * Check if post-processing is needed (any param differs from default)
 */
export function needsPostProcess(params: Partial<OutputPostProcessParams>): boolean {
  if (params.blackout) return true;
  if (params.brightness !== undefined && params.brightness !== 1) return true;
  if (params.gamma !== undefined && params.gamma !== 1) return true;
  if (params.contrast !== undefined && params.contrast !== 1) return true;
  if ((params.edgeBlendLeft ?? 0) > 0) return true;
  if ((params.edgeBlendRight ?? 0) > 0) return true;
  if ((params.edgeBlendTop ?? 0) > 0) return true;
  if ((params.edgeBlendBottom ?? 0) > 0) return true;
  return false;
}

/**
 * Apply edge blending overlay to the output canvas.
 * Draws semi-transparent black gradient strips on edges.
 */
export function applyEdgeBlending(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  params: Partial<OutputPostProcessParams>
) {
  const p = { ...DEFAULT_PARAMS, ...params };
  const gamma = p.edgeBlendGamma;

  // Left edge
  if (p.edgeBlendLeft > 0) {
    const blendW = Math.round(width * p.edgeBlendLeft);
    for (let x = 0; x < blendW; x++) {
      const t = x / blendW;
      const alpha = 1 - Math.pow(t, 1 / gamma);
      ctx.fillStyle = `rgba(0,0,0,${alpha})`;
      ctx.fillRect(x, 0, 1, height);
    }
  }

  // Right edge
  if (p.edgeBlendRight > 0) {
    const blendW = Math.round(width * p.edgeBlendRight);
    for (let x = 0; x < blendW; x++) {
      const t = x / blendW;
      const alpha = 1 - Math.pow(t, 1 / gamma);
      ctx.fillStyle = `rgba(0,0,0,${alpha})`;
      ctx.fillRect(width - 1 - x, 0, 1, height);
    }
  }

  // Top edge
  if (p.edgeBlendTop > 0) {
    const blendH = Math.round(height * p.edgeBlendTop);
    for (let y = 0; y < blendH; y++) {
      const t = y / blendH;
      const alpha = 1 - Math.pow(t, 1 / gamma);
      ctx.fillStyle = `rgba(0,0,0,${alpha})`;
      ctx.fillRect(0, y, width, 1);
    }
  }

  // Bottom edge
  if (p.edgeBlendBottom > 0) {
    const blendH = Math.round(height * p.edgeBlendBottom);
    for (let y = 0; y < blendH; y++) {
      const t = y / blendH;
      const alpha = 1 - Math.pow(t, 1 / gamma);
      ctx.fillStyle = `rgba(0,0,0,${alpha})`;
      ctx.fillRect(0, height - 1 - y, width, 1);
    }
  }
}

/**
 * Apply brightness/gamma/contrast via CSS filter on a canvas element.
 * This is the most performant approach — GPU-accelerated via the compositor.
 */
export function getOutputFilterCSS(params: Partial<OutputPostProcessParams>): string {
  const p = { ...DEFAULT_PARAMS, ...params };
  const filters: string[] = [];

  if (p.brightness !== 1) {
    filters.push(`brightness(${p.brightness})`);
  }
  if (p.contrast !== 1) {
    filters.push(`contrast(${p.contrast})`);
  }
  // CSS doesn't have a native gamma filter, so we approximate with brightness curve
  // For true gamma: use brightness(gamma^-1) as rough approximation
  if (p.gamma !== 1) {
    // Gamma correction approximation via brightness adjustment
    // gamma < 1 = brighter midtones, gamma > 1 = darker midtones
    const gammaBrightness = Math.pow(0.5, p.gamma) / 0.5;
    filters.push(`brightness(${gammaBrightness.toFixed(3)})`);
  }

  return filters.length > 0 ? filters.join(' ') : 'none';
}
