/**
 * confirmPrompt — shared state for the in-app Safe Mode confirm popover.
 *
 * One global popover instance lives in App.svelte and subscribes to this
 * store. When `confirmIfSafeMode(...)` (or its delete variant) is called
 * with Safe Mode on, it pushes a new prompt here and returns a Promise
 * that resolves when the user clicks Yes/Cancel (or presses Esc / clicks
 * outside). This replaces the OS-level `window.confirm` dialog with a
 * small popover anchored near the action point — it feels native to the
 * app instead of yanking focus to the system shell.
 */
import { writable } from 'svelte/store';

export interface ConfirmPrompt {
  /** Short headline shown bold at the top. */
  title: string;
  /** Optional smaller subtitle / undo hint. */
  subtitle?: string;
  /** Confirm-button label. Defaults to "Delete" for delete prompts. */
  confirmLabel: string;
  /** Cancel-button label. Defaults to "Cancel". */
  cancelLabel: string;
  /** Treat the action as destructive — confirm button is red. */
  destructive: boolean;
  /** Anchor point in viewport coords. Popover floats near here. */
  anchorX: number;
  anchorY: number;
  /** Resolver — called with true (confirm) or false (cancel/dismiss). */
  resolve: (ok: boolean) => void;
}

export const confirmPrompt = writable<ConfirmPrompt | null>(null);
