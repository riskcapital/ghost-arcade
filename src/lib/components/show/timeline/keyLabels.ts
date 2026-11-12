/**
 * Key names shown in the show tray, per platform, and whether one of the
 * tray's menus is open (Esc is then the menu's).
 */

/** A Mac (Cmd, Option, ⌫ glyphs) rather than Windows / Linux (Ctrl, Alt, words). */
export function onMac(platform: string = typeof navigator !== 'undefined' ? navigator.platform : ''): boolean {
  return /Mac|iPhone|iPad/i.test(platform);
}

export interface ShortcutLabels {
  /** Duplicate: ⌘D / Ctrl+D. */
  duplicate: string;
  /** Delete: ⌫ / Del. */
  delete: string;
  /** Ripple delete: ⇧⌫ / Shift+Del. */
  rippleDelete: string;
  /** Split at the playhead: ⌘K / Ctrl+K. */
  split: string;
  /** Group / ungroup blocks: ⌘G, ⇧⌘G / Ctrl+G, Ctrl+Shift+G. */
  group: string;
  ungroup: string;
}

export function shortcutLabels(mac = onMac()): ShortcutLabels {
  return mac
    ? { duplicate: '⌘D', delete: '⌫', rippleDelete: '⇧⌫', split: '⌘K', group: '⌘G', ungroup: '⇧⌘G' }
    : { duplicate: 'Ctrl+D', delete: 'Del', rippleDelete: 'Shift+Del', split: 'Ctrl+K', group: 'Ctrl+G', ungroup: 'Ctrl+Shift+G' };
}

/**
 * The tray's menus and popovers. They close on Esc themselves; the tray's
 * Esc (clear the selection) must not also run, or one key does two things.
 */
const POPOVERS = [
  '[data-clip-menu]',
  '[data-add-track-menu]',
  '[data-takeover-menu]',
  '[data-lane-picker-menu]',
  '[data-takeover-release-popover]',
  '[data-camera-clip-inspector]',
  '.kl-menu',
].join(',');

export function showPopoverOpen(root: Pick<Document, 'querySelector'> | null = typeof document !== 'undefined' ? document : null): boolean {
  return !!root?.querySelector(POPOVERS);
}
