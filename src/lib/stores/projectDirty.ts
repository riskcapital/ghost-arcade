/**
 * Has the project changed since it was last saved (or opened)?
 *
 * The old check compared a handful of layer fields (id, name, type, opacity,
 * visibility, corners, content fit) and the project name. Effects, shader
 * params, blend modes, meshes, masks, crops, Screens, VJ clips and stage
 * presets did not count, so closing after editing them asked nothing and
 * the edits were lost.
 *
 * A change is now detected two ways:
 *  - Everything undo covers (every layer and project field, keyframes,
 *    Screens, Master Warp): the undo step the project is at differs from
 *    the one it was at when saved. Undoing back to the saved step makes the
 *    project clean again. Live control and automation never record a step,
 *    so a show that was only played does not count as changed.
 *  - The parts of the project undo does not cover (output settings, media
 *    library, VJ clip grid, modulation, macros, control bindings, snapshots,
 *    sequencer, audio calibration, show timeline and cue list, the music
 *    studio): a signature
 *    of their settings, leaving out what changes while performing (macro
 *    values, active clips, playheads, panel visibility).
 */

import { SONG_SETUP_GROUPS } from '../music/songGroups';

export interface ProjectDirtySnapshot {
  /** history.currentStepId() */
  stepId: number | null;
  /** projectSettingsSignature() */
  settings: string;
  /** Change counters kept elsewhere (Map Sim edits, relinked media). */
  counters: string;
  /** The signature section by section, as it is (see withRecallsAsSaved). */
  sections?: Record<string, string>;
}

export interface ProjectSettingsSections {
  /** project.exportProject() output. */
  exported: Record<string, any>;
  /** showTimeline.serialize() */
  showTimeline?: unknown;
  /** serializeShowControl() */
  showControl?: unknown;
  /** The Stage 3D scene (saved with the project, outside undo). */
  stage3d?: unknown;
}

const omit = (value: unknown, keys: readonly string[]) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const out: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  for (const key of keys) delete out[key];
  return out;
};

// A clip's identity. Edits to a clip's settings (a Music Studio clip's
// voices among them) are counted where they happen (vjEditVersion), so live
// control moving them (a controller, a song called up) is not an edit.
const clipIdentity = (clip: any) => (clip ? { id: clip.id, type: clip.type, name: clip.name } : null);
const gridIdentity = (grid: unknown) =>
  Array.isArray(grid) ? grid.map((row) => (Array.isArray(row) ? row.map(clipIdentity) : [])) : [];

const INPUT_STRIP = /^input\d*$/;
type StudioGroup = keyof typeof SONG_SETUP_GROUPS;
const STUDIO_SETUP_KEYS: string[] = Object.values(SONG_SETUP_GROUPS).flat();

/**
 * The music studio's section, less what playing it moves (knobs, octave,
 * velocity, drum mutes) and less the setup a song calls up, which is in
 * three sections of its own (studioSound, studioBand, studioVisuals) so
 * calling a song up can read as playing (see RecallSection).
 */
const studioIdentity = (studio: any) => {
  if (!studio || typeof studio !== 'object') return null;
  // Moving through the set list is playing the show, not editing it.
  return omit(studio, ['octave', 'velocity', 'currentSongId', 'setlistCursor', ...STUDIO_SETUP_KEYS]);
};

/** One part of the studio's setup: its sound, its band settings or its note visuals. */
function studioGroupIdentity(studio: any, group: StudioGroup): unknown {
  if (!studio || typeof studio !== 'object') return null;
  const out: Record<string, unknown> = {};
  for (const key of SONG_SETUP_GROUPS[group] as readonly string[]) {
    if (key === 'params' || key === 'drumMutes' || key === 'mixer') continue;
    out[key] = studio[key];
  }
  // Mixer strips without mute and solo: the instruments' with the sound, the band inputs' with the band.
  if (group === 'sound' || group === 'band') {
    const mixer = studio.mixer && typeof studio.mixer === 'object' ? studio.mixer : {};
    out.mixer = Object.fromEntries(
      Object.entries(mixer)
        .filter(([id]) => INPUT_STRIP.test(id) === (group === 'band'))
        .map(([id, strip]) => [id, omit(strip, ['mute', 'solo'])]),
    );
  }
  return out;
}

const STUDIO_SECTIONS: Record<'studioSound' | 'studioBand' | 'studioVisuals', StudioGroup> = {
  studioSound: 'sound',
  studioBand: 'band',
  studioVisuals: 'visuals',
};

/** A Stage 3D scene's fingerprint: embedded models (data URLs of many MB)
 *  are reduced to their length and ends instead of being copied whole. */
function stage3dIdentity(scene: unknown): string | null {
  if (!scene || typeof scene !== 'object') return null;
  return JSON.stringify(scene, (_key, value) =>
    typeof value === 'string' && value.length > 65536
      ? `#${value.length}:${value.slice(0, 96)}:${value.slice(-96)}`
      : value);
}

/** Stage Designer surfaces, less what a running effect show moves. */
const surfacesIdentity = (surfaces: unknown) =>
  Array.isArray(surfaces)
    ? surfaces.map((surface: any) => {
        const out = omit(surface, ['activeEffectId']) as Record<string, unknown> | null;
        if (out && surface?.effectAutomation) out.effectAutomation = omit(surface.effectAutomation, ['playing']);
        return out;
      })
    : null;

/** Sections an automated recall (a show cue, a VJ clip's preset, a MIDI- or
 *  Live-triggered stage preset, a song called up) can rewrite. */
export type RecallSection = 'sequencer' | 'keyframeSettings' | 'surfaces' | 'stage3d' | 'studioSound' | 'studioBand' | 'studioVisuals';

/**
 * One recallable section's part of the signature, from the value its store
 * holds (layerSequencer.serialize(), keyframeTimeline.exportSettings(),
 * project.surfaces, the Stage 3D scene, musicStudio.serialize() for the
 * studio's three). The same text the full signature holds for it, so the
 * two can be compared.
 */
export function recallSectionSignature(section: RecallSection, value: unknown): string {
  switch (section) {
    case 'sequencer': {
      const seq = value as { pattern?: unknown; config?: unknown } | null | undefined;
      return JSON.stringify(seq ? { pattern: seq.pattern, config: seq.config } : null);
    }
    case 'keyframeSettings':
      return JSON.stringify(value ?? null);
    case 'surfaces':
      return JSON.stringify(surfacesIdentity(value ?? []));
    case 'stage3d':
      return stage3dIdentity(value) ?? 'null';
    case 'studioSound':
    case 'studioBand':
    case 'studioVisuals':
      return JSON.stringify(studioGroupIdentity(value, STUDIO_SECTIONS[section]) ?? null);
  }
}

/**
 * The project settings undo does not cover, section by section (each the
 * JSON of what counts in it). Equal sections mean nothing there was edited.
 */
export function projectSettingsSections({ exported, showTimeline, showControl, stage3d }: ProjectSettingsSections): Record<string, string> {
  const project = exported?.project ?? {};
  const vj = exported?.vjClipLauncher;
  const sections: Record<string, unknown> = {
    output: {
      settings: project.outputSettings ?? null,
      width: project.outputMasterCanvasWidth ?? null,
      height: project.outputMasterCanvasHeight ?? null,
    },
    media: Array.isArray(exported?.mediaLibrary)
      ? exported.mediaLibrary.map((item: any) => ({ id: item.id, name: item.name, type: item.type }))
      : [],
    vj: vj ? {
      numLayers: vj.numLayers,
      numColumns: vj.numColumns,
      groups: vj.groups ?? null,
      blocks: Array.isArray(vj.blocks)
        ? vj.blocks.map((block: any) => ({
            id: block.id,
            name: block.name,
            a: gridIdentity(block.clipGrid),
            b: gridIdentity(block.bankBClipGrid),
          }))
        : [],
    } : null,
    modulation: Array.isArray(exported?.modulation)
      ? exported.modulation.map((entry: any) => ({ key: entry.key, mod: omit(entry.mod, ['autoPhase', 'clipEffect', 'compositionEffect']) }))
      : [],
    macros: Array.isArray(exported?.macros?.macros)
      ? exported.macros.macros.map((macro: any) => omit(macro, ['value']))
      : [],
    osc: exported?.osc ?? null,
    ableton: omit(exported?.abletonBridge ?? null, ['linkedCounts']),
    musicStudio: studioIdentity(exported?.musicStudio),
    dmx: exported?.dmxInput ?? null,
    keyboard: exported?.keyboard ?? null,
    mediaPipe: exported?.mediaPipe ?? null,
    snapshots: exported?.snapshots ?? null,
    // The tempo follows MIDI clock, Link and tap while performing.
    audio: omit(exported?.audio ?? null, ['manualBPM']),
    geoDeck: exported?.geoDeck
      ? { sceneSlots: exported.geoDeck.sceneSlots ?? null, modRoutes: exported.geoDeck.modRoutes ?? null }
      : null,
    showTimeline: showTimeline && typeof showTimeline === 'object'
      ? {
          ...(omit(showTimeline, ['isOpen', 'zoom', 'audioTracks']) as object),
          audioTracks: Array.isArray((showTimeline as any).audioTracks)
            ? (showTimeline as any).audioTracks.map((track: any) => omit(track, ['url']))
            : [],
        }
      : null,
    showControl: showControl ?? null,
  };
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(sections)) out[key] = JSON.stringify(value ?? null);
  out.keyframeSettings = recallSectionSignature('keyframeSettings', exported?.keyframeSettings);
  out.surfaces = recallSectionSignature('surfaces', project.surfaces);
  out.stage3d = recallSectionSignature('stage3d', stage3d);
  out.sequencer = recallSectionSignature('sequencer', exported?.layerSequencer);
  for (const section of Object.keys(STUDIO_SECTIONS) as (keyof typeof STUDIO_SECTIONS)[]) {
    out[section] = recallSectionSignature(section, exported?.musicStudio);
  }
  return out;
}

/** The whole signature, one string. Equal signatures mean nothing was edited. */
export function projectSettingsSignature(input: ProjectSettingsSections): string {
  return JSON.stringify(projectSettingsSections(input));
}

/**
 * Playing a show is not editing it. A section still exactly as an automated
 * recall left it (`imprint`) reads as it was saved; once anything else
 * changes it, it counts again.
 */
export function withRecallsAsSaved(
  now: Record<string, string>,
  imprint: Partial<Record<RecallSection, string>>,
  saved: Record<string, string> | null | undefined,
): Record<string, string> {
  if (!saved) return now;
  let out = now;
  for (const [key, value] of Object.entries(imprint)) {
    if (value === undefined || now[key] !== value || !(key in saved)) continue;
    if (out === now) out = { ...now };
    out[key] = saved[key];
  }
  return out;
}

/** True when `now` differs from the snapshot taken at the last save.
 *  A null baseline (a recovered autosave, which is not on disk) is always
 *  unsaved. */
export function isProjectDirty(saved: ProjectDirtySnapshot | null, now: ProjectDirtySnapshot): boolean {
  if (!saved) return true;
  return saved.stepId !== now.stepId || saved.settings !== now.settings || saved.counters !== now.counters;
}
