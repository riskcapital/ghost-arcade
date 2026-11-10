/**
 * Whether install mode is running in this window right now: this launch is
 * in show mode and nobody has left it with the exit key combo or Settings.
 */
import { writable, get } from 'svelte/store';
import { isShowModeLaunch } from '../show/showStartup';

export const installPaused = writable(false);

export function installModeRunning(): boolean {
  return isShowModeLaunch() && !get(installPaused);
}
