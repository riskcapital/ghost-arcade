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
 *  - Everything undo covers (every layer and project field, and the
 *    keyframes): the undo step the project is at differs from the one it
 *    was at when saved. Undoing back to the saved step makes the project
 *    clean again. Live control and automation never record a step, so a
 *    show that was only played does not count as changed.
 *  - The parts of the project undo does not cover (the output stage, Stage
 *    Designer surfaces, media folders and library, VJ clip grid,
 *    modulation, macros, control bindings, snapshots, sequencer, audio
 *    calibration, show timeline and cue list): a signature of their
 *    settings, leaving out what changes while performing (macro values,
 *    active clips, playheads, panel visibility). The keyframes are in it
 *    too: an armed track under live control writes keyframes without a
 *    step, and they are still unsaved.
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

/**
 * A stable signature of the project settings undo does not cover. Equal
 * signatures mean nothing there was edited.
 */
export function projectSettingsSignature({ exported, showTimeline, showControl }: ProjectSettingsSections): string {
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
    surfaces: { surfaces: project.surfaces ?? null, active: project.activeSurfaceId ?? null },
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
    audio: exported?.audio ?? null,
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
