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

export type ShowKeyAction =
  | 'delete'
  | 'rippleDelete'
  | 'split'
  | 'duplicate'
  | 'copy'
  | 'cut'
  | 'paste'
  | 'selectAll'
  | 'nudgeLeft'
  | 'nudgeRight'
  | 'nudgeBarLeft'
  | 'nudgeBarRight'
  | 'toggleSnap'
  | 'marker'
  | 'home'
  | 'end'
  | 'clearSelection'
  | 'takeover'
  | 'returnAll'
  | 'returnAllInstant'
  /** L or R held down (key repeat): the show takes the key and does nothing. */
  | 'heldTakeoverKey';

export interface ShowKeyContext {
  /** The tray is open and visible. */
  open: boolean;
  /** The pointer is over the tray, or focus is inside it. */
  engaged: boolean;
  /** Something in the show is selected that a key could act on. */
  hasSelection: boolean;
  /** Clips on layer tracks (or keys on their lanes) are selected. */
  hasClipSelection?: boolean;
  /** The clipboard holds track clips. */
  canPaste?: boolean;
  /** The show has layer tracks (split, select all). */
  hasTracks?: boolean;
  /** A live takeover is on (R hands everything back). */
  takeoverActive?: boolean;
}

interface KeyLike {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  /** The key is held down and repeating. */
  repeat?: boolean;
  target?: EventTarget | null;
}

function isTextEntry(target: EventTarget | null | undefined): boolean {
  const el = target as { tagName?: string; isContentEditable?: boolean } | null | undefined;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}

/**
 * Which show action, if any, this key is while the tray is in `ctx`.
 *
 * Space stays with the app (it is the transport there too); B and T stay
 * global (blackout, test pattern).
 */
export function classifyShowKey(e: KeyLike, ctx: ShowKeyContext): ShowKeyAction | null {
  if (!ctx.open || !ctx.engaged) return null;
  if (isTextEntry(e.target)) return null;
  const mod = !!(e.metaKey || e.ctrlKey);
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (e.altKey) return null;
  if (key === 'Delete' || key === 'Backspace') {
    if (mod) return null;
    if (e.shiftKey && ctx.hasClipSelection) return 'rippleDelete';
    return ctx.hasSelection ? 'delete' : null;
  }
  if (mod) {
    if (e.shiftKey) return null;
    if (key === 'k') return ctx.hasTracks ? 'split' : null;
    if (key === 'd') return ctx.hasClipSelection ? 'duplicate' : null;
    if (key === 'c') return ctx.hasClipSelection ? 'copy' : null;
    if (key === 'x') return ctx.hasClipSelection ? 'cut' : null;
    if (key === 'v') return ctx.canPaste ? 'paste' : null;
    if (key === 'a') return ctx.hasTracks ? 'selectAll' : null;
    return null;
  }
  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    if (!ctx.hasClipSelection) return null;
    if (key === 'ArrowLeft') return e.shiftKey ? 'nudgeBarLeft' : 'nudgeLeft';
    return e.shiftKey ? 'nudgeBarRight' : 'nudgeRight';
  }
  // L takes the focused track over live (or hands it back); R returns
  // every taken-over track, Shift+R instantly.
  // Holding either down acts once: a repeating L would toggle the takeover
  // about 30 times a second.
  if (key === 'r') return ctx.takeoverActive ? (e.repeat ? 'heldTakeoverKey' : e.shiftKey ? 'returnAllInstant' : 'returnAll') : null;
  if (e.shiftKey) return null;
  if (key === 'l') return ctx.hasTracks ? (e.repeat ? 'heldTakeoverKey' : 'takeover') : null;
  if (key === 's') return ctx.hasTracks ? 'split' : null;
  if (key === 'n') return 'toggleSnap';
  if (key === 'm') return 'marker';
  if (key === 'Home') return 'home';
  if (key === 'End') return 'end';
  if (key === 'Escape') return ctx.hasSelection || ctx.hasClipSelection ? 'clearSelection' : null;
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

/**
 * While the tray is mounted, the show's keys are taken before any other
 * window listener sees them: a capture listener on the window runs ahead of
 * the app's own shortcuts and of panels with listeners of their own (the
 * dock's Cmd+K, the mapping canvas's arrow nudges). A key the show takes is
 * stopped there; every other key goes on as before. Returns the uninstall.
 */
export function installShowKeyCapture(target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window): () => void {
  const listener = (e: Event) => {
    const ke = e as KeyboardEvent;
    if (handleShowKeydown(ke)) ke.stopPropagation();
  };
  target.addEventListener('keydown', listener, true);
  return () => target.removeEventListener('keydown', listener, true);
}
