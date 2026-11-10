/**
 * Keys that belong to the show timeline while the pointer (or focus) is in
 * its tray.
 *
 * App.svelte's app-wide keydown handler asks here first, before its own
 * Copy / Paste / Duplicate / Delete / arrow shortcuts. If the show takes the
 * key, the event is marked handled and the app-wide shortcut does not run.
 * Before this, the tray and the app each had their own window listener and
 * neither checked the other: Delete with a show clip selected removed the
 * clip AND the selected mapping layer.
 *
 * The tray registers the handler that knows its selection; this module only
 * decides which keys are the show's (`classifyShowKey`, pure) and routes them.
 */

export type ShowKeyAction = 'delete';

export interface ShowKeyContext {
  /** The tray is open and visible. */
  open: boolean;
  /** The pointer is over the tray, or focus is inside it. */
  engaged: boolean;
  /** Something in the show is selected that a key could act on. */
  hasSelection: boolean;
}

interface KeyLike {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  target?: EventTarget | null;
}

function isTextEntry(target: EventTarget | null | undefined): boolean {
  const el = target as { tagName?: string; isContentEditable?: boolean } | null | undefined;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}

/** Which show action, if any, this key is while the tray is in `ctx`. */
export function classifyShowKey(e: KeyLike, ctx: ShowKeyContext): ShowKeyAction | null {
  if (!ctx.open || !ctx.engaged) return null;
  if (isTextEntry(e.target)) return null;
  if ((e.key === 'Delete' || e.key === 'Backspace') && !e.metaKey && !e.ctrlKey && !e.altKey) {
    return ctx.hasSelection ? 'delete' : null;
  }
  return null;
}

/** The tray's handler: returns true when it acted on the key. */
export type ShowKeyHandler = (e: KeyboardEvent) => boolean;

let handler: ShowKeyHandler | null = null;

/** Registered by the show tray while it is mounted. Returns the unregister. */
export function setShowKeyHandler(next: ShowKeyHandler | null): () => void {
  handler = next;
  return () => {
    if (handler === next) handler = null;
  };
}

/**
 * Called by App.svelte before its own shortcuts. True means the show took
 * the key (and the event is marked handled): the caller must stop there.
 */
export function handleShowKeydown(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || !handler) return false;
  let taken = false;
  try {
    taken = handler(e);
  } catch (err) {
    console.warn('[ShowTimeline] key handler failed:', err);
  }
  if (taken && !e.defaultPrevented) e.preventDefault();
  return taken;
}
