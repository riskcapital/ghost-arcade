import { invoke, isDesktopApp } from '$lib/bridge';

/** The debug log the desktop app writes each launch (the last three are kept). */
export const DEBUG_LOG_NAME = 'ghost-arcade-debug.log';

/** Show the folder holding the app's debug log, with the log selected. */
export async function openLogFolder(): Promise<boolean> {
  if (!isDesktopApp) return false;
  try {
    const result = await invoke<{ success?: boolean }>('open_log_folder');
    return result?.success !== false;
  } catch (err) {
    console.warn('[logs] could not open the log folder', err);
    return false;
  }
}
