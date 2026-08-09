import { get, writable } from 'svelte/store';

export type NativePerformerWorldDeck = 'A' | 'B';

export interface NativePerformerWorldOverlay {
  deck: NativePerformerWorldDeck;
  layerIndex: number;
  enabled: boolean;
  worldIndex: number;
  spaceIndex: number;
  x: number;
  y: number;
  pointerDown: boolean;
  params: number[];
  pump: number;
}

export interface NativePerformerWorldOverlayState {
  A: NativePerformerWorldOverlay | null;
  B: NativePerformerWorldOverlay | null;
}

const initialState: NativePerformerWorldOverlayState = {
  A: null,
  B: null,
};

const store = writable<NativePerformerWorldOverlayState>(initialState);
const signatures: Record<NativePerformerWorldDeck, string> = { A: '', B: '' };

function overlaySignature(overlay: NativePerformerWorldOverlay | null): string {
  if (!overlay) return '';
  return JSON.stringify([
    overlay.layerIndex,
    overlay.enabled,
    overlay.worldIndex,
    overlay.spaceIndex,
    overlay.x,
    overlay.y,
    overlay.pointerDown,
    overlay.params,
    overlay.pump,
  ]);
}

export const nativePerformerWorldOverlays = {
  subscribe: store.subscribe,

  setOverlay(overlay: NativePerformerWorldOverlay): void {
    const signature = overlaySignature(overlay);
    if (signatures[overlay.deck] === signature) return;
    signatures[overlay.deck] = signature;
    store.update((state) => ({ ...state, [overlay.deck]: overlay }));
  },

  clear(deck: NativePerformerWorldDeck): void {
    if (!get(store)[deck]) return;
    signatures[deck] = '';
    store.update((state) => ({ ...state, [deck]: null }));
  },

  clearAll(): void {
    const state = get(store);
    if (!state.A && !state.B) return;
    signatures.A = '';
    signatures.B = '';
    store.set(initialState);
  },
};
