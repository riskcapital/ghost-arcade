// A Look card dragged out of the Looks gallery (onto the Timeline's Looks row).

export const EDGE_LOOK_DRAG_TYPE = 'application/x-ghost-edge-look';

export interface EdgeLookDragPayload {
  lookId: string;
  paletteId: string;
  scope: 'all' | 'pieces';
  layerIds?: string[];
}

/** The payload of a drop, or null when it is not a Look card. */
export function readEdgeLookDrag(dt: DataTransfer | null | undefined): EdgeLookDragPayload | null {
  const raw = dt?.getData(EDGE_LOOK_DRAG_TYPE);
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<EdgeLookDragPayload>;
    if (typeof p.lookId !== 'string' || !p.lookId) return null;
    return {
      lookId: p.lookId,
      paletteId: typeof p.paletteId === 'string' ? p.paletteId : '',
      scope: p.scope === 'pieces' ? 'pieces' : 'all',
      ...(p.scope === 'pieces' && Array.isArray(p.layerIds) ? { layerIds: p.layerIds.filter((id) => typeof id === 'string') } : {}),
    };
  } catch {
    return null;
  }
}

/** The drag carries a Look card (types only: dragover). */
export function carriesEdgeLook(dt: DataTransfer | null | undefined): boolean {
  return Array.from(dt?.types ?? []).includes(EDGE_LOOK_DRAG_TYPE);
}
