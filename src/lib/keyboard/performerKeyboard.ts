export interface PerformerClipKey {
  key: string;
  code: string;
}

export const PERFORMER_CLIP_ROW1: PerformerClipKey[] = [
  { key: '1', code: 'Digit1' }, { key: '2', code: 'Digit2' },
  { key: '3', code: 'Digit3' }, { key: '4', code: 'Digit4' },
  { key: '5', code: 'Digit5' }, { key: '6', code: 'Digit6' },
  { key: '7', code: 'Digit7' }, { key: '8', code: 'Digit8' },
  { key: '9', code: 'Digit9' }, { key: '0', code: 'Digit0' },
];

export const PERFORMER_CLIP_ROW2: PerformerClipKey[] = [
  { key: 'Q', code: 'KeyQ' }, { key: 'W', code: 'KeyW' },
  { key: 'E', code: 'KeyE' }, { key: 'R', code: 'KeyR' },
  { key: 'T', code: 'KeyT' }, { key: 'Y', code: 'KeyY' },
  { key: 'U', code: 'KeyU' }, { key: 'I', code: 'KeyI' },
  { key: 'O', code: 'KeyO' }, { key: 'P', code: 'KeyP' },
];

export const PERFORMER_CLIP_ROW3: PerformerClipKey[] = [
  { key: 'A', code: 'KeyA' }, { key: 'S', code: 'KeyS' },
  { key: 'D', code: 'KeyD' }, { key: 'F', code: 'KeyF' },
  { key: 'G', code: 'KeyG' }, { key: 'H', code: 'KeyH' },
  { key: 'J', code: 'KeyJ' }, { key: 'K', code: 'KeyK' },
  { key: 'L', code: 'KeyL' },
];

export const PERFORMER_CLIP_ROW4: PerformerClipKey[] = [
  { key: 'Z', code: 'KeyZ' }, { key: 'X', code: 'KeyX' },
  { key: 'C', code: 'KeyC' }, { key: 'V', code: 'KeyV' },
  { key: 'B', code: 'KeyB' }, { key: 'N', code: 'KeyN' },
  { key: 'M', code: 'KeyM' },
];

export const PERFORMER_CLIP_KEYS = [
  ...PERFORMER_CLIP_ROW1,
  ...PERFORMER_CLIP_ROW2,
  ...PERFORMER_CLIP_ROW3,
  ...PERFORMER_CLIP_ROW4,
];

const CLIP_INDEX_BY_CODE = new Map(
  PERFORMER_CLIP_KEYS.map((clip, index) => [clip.code, index]),
);

export type PerformerKeyboardAction =
  | { type: 'clip'; clipPosition: number }
  | { type: 'randomize' }
  | { type: 'xfade'; delta: number }
  | { type: 'space'; delta: number }
  | { type: 'world'; delta: number }
  | { type: 'spaceFx' }
  | { type: 'focus' }
  | { type: 'invert' }
  | { type: 'blackout' }
  | { type: 'glitch' }
  | { type: 'drift' }
  | { type: 'resetMomentaries' };

export interface PerformerKeyboardGesture {
  code: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  repeat?: boolean;
}

export function performerClipIndexForCode(code: string): number | null {
  return CLIP_INDEX_BY_CODE.get(code) ?? null;
}

export function resolvePerformerKeyboardAction(
  gesture: PerformerKeyboardGesture,
  editMode = false,
): PerformerKeyboardAction | null {
  if (gesture.ctrlKey || gesture.altKey || gesture.metaKey || gesture.repeat) return null;

  if (!gesture.shiftKey && !editMode) {
    const clipPosition = performerClipIndexForCode(gesture.code);
    if (clipPosition !== null) return { type: 'clip', clipPosition };
  }

  if (gesture.shiftKey) {
    switch (gesture.code) {
      case 'KeyB': return { type: 'blackout' };
      case 'KeyC': return { type: 'randomize' };
      case 'KeyM': return { type: 'glitch' };
      case 'KeyN': return { type: 'invert' };
      case 'KeyX': return { type: 'drift' };
      default: return null;
    }
  }

  switch (gesture.code) {
    case 'Tab': return { type: 'randomize' };
    case 'ArrowLeft': return { type: 'xfade', delta: -0.05 };
    case 'ArrowRight': return { type: 'xfade', delta: 0.05 };
    case 'Semicolon': return { type: 'space', delta: -1 };
    case 'Quote': return { type: 'space', delta: 1 };
    case 'Comma': return { type: 'world', delta: -1 };
    case 'Period': return { type: 'world', delta: 1 };
    case 'Space': return { type: 'spaceFx' };
    case 'Backquote': return { type: 'focus' };
    case 'Escape': return { type: 'resetMomentaries' };
    default: return null;
  }
}
