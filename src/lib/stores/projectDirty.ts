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
 *  - Everything undo covers (every layer and project field, the keyframes,
 *    the Screens and the Master Warp): the undo step the project is at
 *    differs from the one it was at when saved. Undoing back to the saved
 *    step makes the project clean again. Live control and automation never
 *    record a step, so a show that was only played does not count as
 *    changed.
 *  - The parts of the project undo does not cover (the rest of the output
 *    stage, Stage Designer surfaces, media folders and library, VJ clip
 *    grid, modulation, macros, control bindings, snapshots, sequencer,
 *    audio calibration, show timeline and cue list): a signature of their
 *    settings, leaving out what changes while performing (macro values,
 *    active clips, playheads, panel visibility). The keyframes, Screens and
 *    Master Warp are in it too, as they can change without a step (an
 *    armed track under live control, a Stage 3D sync) and are then still
 *    unsaved.
 */

export interface ProjectDirtySnapshot {
  /** history.currentStepId() */
  stepId: number | null;
  /** projectSettingsSignature() */
  settings: string;
  /** Change counters kept elsewhere (Map Sim and Stage 3D edits, relinked
   *  media). */
  counters: string;
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

const clipIdentity = (clip: any) => (clip ? { id: clip.id, type: clip.type, name: clip.name } : null);
const gridIdentity = (grid: unknown) =>
  Array.isArray(grid) ? grid.map((row) => (Array.isArray(row) ? row.map(clipIdentity) : [])) : [];

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

/**
 * A stable signature of the project settings undo does not cover. Equal
 * signatures mean nothing there was edited.
 */
export function projectSettingsSignature({ exported, showTimeline, showControl, stage3d }: ProjectSettingsSections): string {
  const project = exported?.project ?? {};
  const vj = exported?.vjClipLauncher;
  return JSON.stringify({
    output: {
      slices: project.outputSlices ?? null,
      masterWarp: project.outputMasterWarp ?? null,
      settings: project.outputSettings ?? null,
      width: project.outputMasterCanvasWidth ?? null,
      height: project.outputMasterCanvasHeight ?? null,
    },
    surfaces: { surfaces: surfacesIdentity(project.surfaces), active: project.activeSurfaceId ?? null },
    stage3d: stage3dIdentity(stage3d),
    mediaFolders: project.mediaFolders ?? null,
    keyframes: exported?.keyframeTimelines ?? null,
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
    dmx: exported?.dmxInput ?? null,
    keyboard: exported?.keyboard ?? null,
    mediaPipe: exported?.mediaPipe ?? null,
    snapshots: exported?.snapshots ?? null,
    // The tempo follows MIDI clock, Link and tap while performing.
    audio: omit(exported?.audio ?? null, ['manualBPM']),
    sequencer: exported?.layerSequencer
      ? { pattern: exported.layerSequencer.pattern, config: exported.layerSequencer.config }
      : null,
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
  });
}

/** True when `now` differs from the snapshot taken at the last save.
 *  A null baseline (a recovered autosave, which is not on disk) is always
 *  unsaved. */
export function isProjectDirty(saved: ProjectDirtySnapshot | null, now: ProjectDirtySnapshot): boolean {
  if (!saved) return true;
  return saved.stepId !== now.stepId || saved.settings !== now.settings || saved.counters !== now.counters;
}
