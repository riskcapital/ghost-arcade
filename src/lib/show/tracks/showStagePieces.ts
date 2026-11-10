/**
 * The mapping layers the show's rows were last made from, by id: the stage's
 * own and those of the looks the show uses. A piece that is in none of the
 * show's rows with a copy of its own (a row with nothing on it keeps no
 * copy) is drawn from here when something needs it off stage (a takeover).
 */
import type { Layer } from '../../types';

let pieces = new Map<string, Layer>();

export function setStagePieceLayers(stage: readonly Layer[], looks: ReadonlyArray<readonly Layer[]>): void {
  const next = new Map<string, Layer>();
  for (const layer of stage) if (layer?.id && !next.has(layer.id)) next.set(layer.id, layer);
  for (const look of looks) for (const layer of look) if (layer?.id && !next.has(layer.id)) next.set(layer.id, layer);
  pieces = next;
}

export function stagePieceLayer(id: string): Layer | null {
  return pieces.get(id) ?? null;
}
