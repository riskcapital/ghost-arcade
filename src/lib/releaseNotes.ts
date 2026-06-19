export const DOWNLOAD_PAGE_URL = 'https://ghostarcade.live/download';
export const CHANGELOG_PAGE_URL = 'https://ghostarcade.live/changelog';

export interface AppReleaseNotes {
  title: string;
  summary: string[];
  highlights: string[];
}

const RELEASE_NOTES: Record<string, AppReleaseNotes> = {
  '1.9.4': {
    title: 'Map Sim, keyboard control, and VJ sequencer',
    summary: [
      'Map Sim opens a dedicated projection simulator for mapping practice and proposals.',
      'Keyboard shortcuts now drive VJ, mapping, and performance controls.',
      'VJ mode gets a sequencer, vertical crossfader, and plugins parity.',
    ],
    highlights: [
      'Map Sim adds a dedicated projection-simulation workspace with a Stage Sim-style pop-out window, projector placement, room exposure, shadow strength, floor projection, lockable projectors and objects, copy/paste, snapping, even-spacing guides, fullscreen, recording, save/load, and direct scene selection.',
      'Projection setups now start from focused presets: the isometric cube pyramid, fragmented cube wall, and museum facade. You can edit or delete preset objects, snap them together, space them coherently, and import the same complex GLB/3D model files used by mapping-mode 3D model layers.',
      'Keyboard control joins MIDI and OSC as a first-class control surface: key combinations persist per project and dispatch through the shared mapping router for VJ, mapping, and performance workflows.',
      'VJ Layer Sequencer adds a BPM-synced step grid for opacity gating, with the sequenced output wired through live output, offline rendering, and Stage 3D recording paths.',
      'VJ mode now has a vertical A/B crossfader and a Plugins tab that mirrors the editor Media Library, making performer-mode browsing and deck blending line up with the main editor.',
      'Release/update polish replaces brittle in-app installer downloads with a direct link to the signed download page and shows readable release notes instead of generated GitHub link noise.',
    ],
  },
};

function normalizeVersion(version: string | null | undefined): string {
  return (version ?? '').trim().replace(/^v/i, '');
}

function cleanReleaseBody(body: string | null | undefined): string[] {
  if (!body) return [];

  return body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map((line) => line.replace(/^[-*]\s+/, '').replace(/^#+\s*/, ''))
    .filter((line) => line.length > 0)
    .filter((line) => !/^https?:\/\//i.test(line))
    .filter((line) => !/github\.com/i.test(line))
    .filter((line) => !/full changelog|compare changes|assets?|download/i.test(line))
    .slice(0, 6);
}

export function releaseNotesForVersion(version: string, fallbackBody?: string): AppReleaseNotes {
  const normalized = normalizeVersion(version);
  const notes = RELEASE_NOTES[normalized];
  if (notes) return notes;

  const cleaned = cleanReleaseBody(fallbackBody);
  return {
    title: `Ghost Arcade v${normalized || version}`,
    summary: cleaned.slice(0, 3),
    highlights: cleaned.length > 0
      ? cleaned
      : ['Open the download page for the latest signed installers and release notes.'],
  };
}
