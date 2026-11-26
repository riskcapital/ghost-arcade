export type WarpGranularity = 'free' | 'sub' | '1px' | '5px' | '10px';

export function warpNudgeStepPixels(granularity: WarpGranularity | undefined): number {
  switch (granularity) {
    case 'sub': return 0.5;
    case '5px': return 5;
    case '10px': return 10;
    case 'free':
    case '1px':
    default:
      return 1;
  }
}

export function normalizedWarpNudge(
  projectWidth: number,
  projectHeight: number,
  granularity: WarpGranularity | undefined,
  multiplier = 1,
): { x: number; y: number } {
  const step = warpNudgeStepPixels(granularity) * multiplier;
  return {
    x: step / Math.max(1, projectWidth),
    y: step / Math.max(1, projectHeight),
  };
}

/** The project-pixel grid a mouse drag lands on, or null for 'free'. */
export function warpDragStepPixels(granularity: WarpGranularity | undefined): number | null {
  return granularity === 'free' ? null : warpNudgeStepPixels(granularity);
}

/** Screen-direction arrows of the touch fine-tune pad. */
export type FineTuneArrow = 'up' | 'down' | 'left' | 'right';

/**
 * Where a corner goes for one tap on the fine-tune pad. The pad's arrows
 * are screen directions; corners are stored with y up (1 = top), so "up"
 * raises y. One tap moves one nudge step in project pixels.
 */
export function fineTuneNudgedPoint(
  point: { x: number; y: number },
  arrow: FineTuneArrow,
  projectWidth: number,
  projectHeight: number,
  granularity: WarpGranularity | undefined,
): { x: number; y: number } {
  const step = normalizedWarpNudge(projectWidth, projectHeight, granularity);
  switch (arrow) {
    case 'up': return { x: point.x, y: point.y + step.y };
    case 'down': return { x: point.x, y: point.y - step.y };
    case 'left': return { x: point.x - step.x, y: point.y };
    case 'right': return { x: point.x + step.x, y: point.y };
  }
}
