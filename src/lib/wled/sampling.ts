/** Compute a compact sampling grid that follows the source aspect. */
export function computeWLEDSamplingGrid(
  ledCount: number,
  sourceAspect: number
): { columns: number; rows: number } {
  const count = Math.max(1, Math.min(490, Math.floor(ledCount) || 1));
  const aspect = Number.isFinite(sourceAspect) && sourceAspect > 0 ? sourceAspect : 16 / 9;
  const columns = Math.max(1, Math.min(count, Math.round(Math.sqrt(count * aspect))));
  return { columns, rows: Math.ceil(count / columns) };
}
