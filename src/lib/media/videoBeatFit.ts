/** Fit one complete transport cycle into a requested number of beats. */
export function videoBeatFit(duration: number, trimStart: number, trimEnd: number,
  beats: number, bpm: number, bounce = false, direction = 1) {
  if (![duration, trimStart, trimEnd, beats, bpm].every(Number.isFinite)
    || duration <= 0 || beats <= 0 || bpm <= 0 || trimEnd <= trimStart) return null;
  const cycleSeconds = duration * (trimEnd - trimStart) * (bounce ? 2 : 1);
  const requestedRate = cycleSeconds * bpm / (60 * beats);
  const magnitude = Math.max(0.05, Math.min(8, requestedRate));
  return { rate: magnitude * (direction < 0 ? -1 : 1), requestedRate,
    limited: requestedRate < 0.05 || requestedRate > 8,
    actualBeats: cycleSeconds * bpm / (60 * magnitude) };
}
