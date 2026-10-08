/**
 * Keyboard rules while the Interactive Studio modal is open.
 *
 * The Studio is modal: the app behind it must not act on the keyboard, or
 * Backspace deletes the layer being edited, Cmd/Ctrl+Z rolls the project back
 * under the editor and T puts a test pattern on the live output.
 *
 * Two keys are deliberately let through:
 *  - B, the emergency blackout. It is the one shortcut a live operator must
 *    never lose, and the Studio covers the toolbar button. It is ignored while
 *    typing, never repeats, and the app announces it, because the editor
 *    preview shows the layer before the output stage and would not go dark.
 *  - Space, the keyframe transport, while the Studio's own timeline is open.
 *
 * Everything else is blocked, whatever has focus.
 */
export type StudioModalKeyAction = 'blackout' | 'timeline-transport' | 'block';

export interface StudioModalKeyEvent {
  type: string;
  key: string;
  code?: string;
  repeat?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  defaultPrevented?: boolean;
}

export interface StudioModalKeyContext {
  /** Focus is in a text field, slider, select or editable region. */
  typing: boolean;
  /** The Studio's embedded keyframe timeline is showing. */
  timelineOpen: boolean;
}

/** Same rule the app-wide shortcut handler uses for "the user is typing". */
export function isTypingTarget(target: unknown): boolean {
  const element = target as { tagName?: string; isContentEditable?: boolean } | null;
  if (!element || typeof element.tagName !== 'string') return false;
  const tag = element.tagName.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element.isContentEditable === true;
}

export function studioModalKeyAction(
  event: StudioModalKeyEvent,
  context: StudioModalKeyContext,
): StudioModalKeyAction {
  if (event.type !== 'keydown') return 'block';
  // A control inside the Studio (or a tray above it) already used this key.
  if (event.defaultPrevented) return 'block';
  if (context.typing || event.repeat) return 'block';
  if (event.ctrlKey || event.metaKey || event.altKey) return 'block';
  if (event.key === 'b' || event.key === 'B') return 'blackout';
  if (event.code === 'Space' && context.timelineOpen) return 'timeline-transport';
  return 'block';
}
