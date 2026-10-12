export const VJ_CUE_POINT_COUNT = 8;
export function validCueIndex(index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < VJ_CUE_POINT_COUNT;
}
/** Media seconds retain their meaning when a clip's trim range changes. */
export function normalizeCuePoints(value: unknown): (number | null)[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const points = Array.from({ length: VJ_CUE_POINT_COUNT }, (_, index) => {
    const time = value[index];
    return typeof time === 'number' && Number.isFinite(time) && time >= 0 ? time : null;
  });
  return points.some(time => time !== null) ? points : undefined;
}
