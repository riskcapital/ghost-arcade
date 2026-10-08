/**
 * Keyboard map for the Interactive Studio editor.
 *
 * Kept free of DOM and component state so the mapping can be unit tested:
 * the component describes the key press, this module answers with the
 * commands to run.
 */
export type EditorKeyPress = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  /** The event started on a button, input, select or textarea. */
  fromControl: boolean;
};

export type EditorKeyCommand = 'remove-surface' | 'undo' | 'select-mode';

/** Commands for one key press, in the order they run. */
export function editorKeyCommands(press: EditorKeyPress): EditorKeyCommand[] {
  if (press.fromControl) return [];
  const commands: EditorKeyCommand[] = [];
  if (press.key === 'Delete' || press.key === 'Backspace') commands.push('remove-surface');
  if ((press.metaKey || press.ctrlKey) && press.key === 'z') commands.push('undo');
  if (press.key === 'Escape') commands.push('select-mode');
  return commands;
}

/** Commands that consume the key press (preventDefault + stopPropagation). */
export function consumesKeyPress(command: EditorKeyCommand): boolean {
  return command === 'remove-surface' || command === 'undo';
}
