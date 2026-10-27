/**
 * Where the Control Surface setting lives in Ableton Live, for the setup steps
 * in the Ableton tray.
 *
 * Live names it differently by platform and version:
 * - Windows: Options → Preferences… in Live 10 and 11, Options → Settings… in
 *   Live 12.
 * - macOS: Live → Settings…
 * The Control Surface slots are on the tab named Link / MIDI in Live 10,
 * Link / Tempo / MIDI in Live 11 and Link, Tempo & MIDI in Live 12 (later
 * Live 12 updates move Link to a page of its own, leaving the slots on the
 * MIDI page). Ctrl+, or Cmd+, opens the window in every version.
 *
 * The version comes from Live's preference folders (electron/ableton-bridge.cjs),
 * newest first; with none found the steps name both spellings.
 */

export type LivePlatform = 'mac' | 'windows';

export interface LiveSetupWords {
  /** "Live 12.1.5", or null when no Live has run on this computer. */
  version: string | null;
  major: number | null;
  /** The menu path, e.g. ["Options", "Preferences…"]. */
  menu: string[];
  /** The other spelling when the version is unknown, e.g. "Settings… in Live 12". */
  menuAlternative: string | null;
  /** Keys for the shortcut, e.g. ["⌘", ","] or ["Ctrl", ","]. */
  shortcut: string[];
  /** The tab holding the Control Surface slots. */
  tab: string;
  /** Said after the tab when it may be named differently. */
  tabNote: string | null;
}

export function livePlatform(platform: string | undefined = typeof navigator !== 'undefined' ? navigator.platform : ''): LivePlatform {
  return /mac/i.test(platform ?? '') ? 'mac' : 'windows';
}

export function liveMajor(version: string | null | undefined): number | null {
  const major = Number.parseInt(String(version ?? ''), 10);
  return Number.isFinite(major) && major > 0 ? major : null;
}

export function liveSetupWords(platform: LivePlatform, versions: string[] | null | undefined): LiveSetupWords {
  const newest = versions?.[0] ?? null;
  const major = liveMajor(newest);
  const mac = platform === 'mac';

  // Live 12 renamed Preferences to Settings, on both platforms; the menu is
  // "Live" on macOS and "Options" on Windows.
  const menuName = mac ? 'Live' : 'Options';
  let menu: string[];
  let menuAlternative: string | null = null;
  if (major !== null && major >= 12) {
    menu = [menuName, 'Settings…'];
  } else {
    menu = [menuName, 'Preferences…'];
    if (major === null) menuAlternative = 'Settings… in Live 12';
  }

  let tab: string;
  let tabNote: string | null = null;
  if (major === 10) {
    tab = 'Link / MIDI';
  } else if (major === 11) {
    tab = 'Link / Tempo / MIDI';
  } else if (major !== null && major >= 12) {
    tab = 'Link, Tempo & MIDI';
    tabNote = 'MIDI in the latest Live 12 updates';
  } else {
    tab = 'Link / MIDI';
    tabNote = 'Link, Tempo & MIDI in Live 11 and 12';
  }

  return {
    version: newest ? `Live ${newest}` : null,
    major,
    menu,
    menuAlternative,
    shortcut: mac ? ['⌘', ','] : ['Ctrl', ','],
    tab,
    tabNote,
  };
}
