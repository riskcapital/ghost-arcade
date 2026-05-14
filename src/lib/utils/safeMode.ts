/**
 * safeMode — opt-in confirmation gate for destructive actions.
 *
 * The user is fast — sometimes too fast. They click the × on a shader
 * card meaning to focus a different one, or hit Delete with the wrong
 * layer selected. Safe Mode adds a confirmation prompt to a curated
 * set of "easy to do, hard to undo" actions:
 *   - Deleting a shader / clip / effect / layer
 *   - Clearing all keyframes on a parameter
 *   - Resetting the project / clearing the canvas
 *
 * Off by default — power users hate prompts. The setting lives at
 * `settings.ui.safeMode` (Settings → General → Safe Mode).
 *
 * Implementation: the prompt is rendered in-app via `<ConfirmPopover />`
 * mounted in App.svelte, anchored near the click event. Returns a
 * Promise<boolean> — `true` = user confirmed, `false` = cancelled.
 * If Safe Mode is off, resolves to `true` immediately (no prompt).
 */
import { get } from 'svelte/store';
import { settings } from '../stores/settings';
import { confirmPrompt } from '../stores/confirmPrompt';

interface ConfirmOptions {
  /** Headline. e.g. "Delete layer "Layer 3"?" */
  title: string;
  /** Smaller hint line. e.g. undo instructions. */
  subtitle?: string;
  /** Confirm-button text. Defaults to "OK". */
  confirmLabel?: string;
  /** Cancel-button text. Defaults to "Cancel". */
  cancelLabel?: string;
  /** Style the confirm button as a destructive (red) action. */
  destructive?: boolean;
  /** Click event that triggered the prompt — used to position the popover. */
  event?: MouseEvent | { clientX: number; clientY: number } | null;
}

function resolveAnchor(event?: ConfirmOptions['event']): { x: number; y: number } {
  if (event && typeof event.clientX === 'number' && typeof event.clientY === 'number') {
    return { x: event.clientX, y: event.clientY };
  }
  // Fallback: center of viewport.
  return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}

/**
 * Show the in-app Safe Mode popover (if enabled) and resolve with the
 * user's choice. If Safe Mode is off, resolves immediately to `true`.
 *
 *   if (!(await confirmIfSafeMode({ title: 'Delete shader?', event: e }))) return;
 *   project.removeShader(id);
 */
export function confirmIfSafeMode(opts: ConfirmOptions): Promise<boolean> {
  const s = get(settings);
  if (!s?.ui?.safeMode) return Promise.resolve(true);

  const anchor = resolveAnchor(opts.event);
  return new Promise<boolean>((resolve) => {
    confirmPrompt.set({
      title: opts.title,
      subtitle: opts.subtitle,
      confirmLabel: opts.confirmLabel ?? 'OK',
      cancelLabel: opts.cancelLabel ?? 'Cancel',
      destructive: opts.destructive ?? false,
      anchorX: anchor.x,
      anchorY: anchor.y,
      resolve,
    });
  });
}

/**
 * Convenience wrapper: confirm a "delete X" action with a standardized
 * red button + undo-hint subtitle. Pass the click event for positioning.
 *
 *   if (!(await confirmDeleteIfSafeMode(`layer "${name}"`, e))) return;
 *   project.removeLayer(id);
 */
export function confirmDeleteIfSafeMode(
  itemDescription: string,
  event?: ConfirmOptions['event']
): Promise<boolean> {
  const undoKey = navigator.platform.toLowerCase().includes('mac') ? '⌘Z' : 'Ctrl+Z';
  return confirmIfSafeMode({
    title: `Delete ${itemDescription}?`,
    subtitle: `Use ${undoKey} to undo.`,
    confirmLabel: 'Delete',
    cancelLabel: 'Cancel',
    destructive: true,
    event,
  });
}
