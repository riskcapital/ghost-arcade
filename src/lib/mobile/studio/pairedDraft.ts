/**
 * The paired editor's draft: the last scene edited or sent to the desktop,
 * kept on this phone so that a reconnect or an app restart opens it again.
 *
 * The desktop's Interactive layer says scenes are kept as drafts on the
 * device that edits them. Paired, the scene lived only on the connection, so
 * closing the app lost a scene that was never launched. This keeps it apart
 * from the phone's own (standalone) draft, and with whether it uses the 3D
 * world: such a draft is opened again only with a desktop that has the world
 * (an older desktop gets exactly what phone app 1.2 sent). Restoring never
 * launches it; Use output does, as before.
 */
import { validateScene, type InteractiveScene } from './interactive';
import { isWorldEffect } from './interactiveEffects';

type DraftStorage = Pick<Storage, 'getItem' | 'setItem'>;
export const PAIRED_DRAFT_KEY = 'ghost-interactive-paired-draft-v1';

/** True when the scene needs a desktop with the 3D world: one switched on, or a world effect. */
export const usesWorld = (scene: InteractiveScene): boolean => !!scene.world?.enabled || (scene.effects ?? []).some((e) => isWorldEffect(e.kind));

export function writePairedDraft(storage: DraftStorage, scene: InteractiveScene): void {
  const clean = validateScene(scene);
  storage.setItem(PAIRED_DRAFT_KEY, JSON.stringify({ version: 1, world: usesWorld(clean), scene: clean }));
}

/** The draft, when there is one this desktop can play (`world`: it has the 3D world). */
export function readPairedDraft(storage: DraftStorage, world: boolean): InteractiveScene | null {
  try {
    const raw = storage.getItem(PAIRED_DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as { version?: unknown; world?: unknown; scene?: unknown };
    if (d?.version !== 1 || (d.world === true && !world)) return null;
    const scene = validateScene(d.scene);
    // Never hand an older desktop a world, even switched off.
    if (!world && scene.world) {
      const { world: _w, ...rest } = scene;
      return rest as InteractiveScene;
    }
    return scene;
  } catch {
    return null;
  }
}
