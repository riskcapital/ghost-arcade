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
