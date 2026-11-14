/** Small types shared by the Interactive Studio editor components. */
import type { Point } from '../../mobile/studio/interactive';

/** Select (edit shapes), Draw (outline a new shape) or Play (touch the simulation). */
export type EditorMode = 'perform' | 'draw' | 'edit';

/** Inspector tabs: Scenes, Effects, Objects, Setup. */
export type InspectorTab = 'presets' | 'effects' | 'objects' | 'world' | 'scene';

/** What a touch does to the simulation in Play mode. */
/** What a touch does in Play mode. Throw, Push, Pour and Ignite are for the 3D world. */
export type TouchTool = 'attract' | 'repel' | 'vortex' | 'throw' | 'push' | 'pour' | 'ignite';

/** The emitter or light marker drawn on the stage, in normalised 0–1 coordinates. */
export type EmitterMarker = { x: number; y: number; label: string };

/** Where depth setup is: choosing how, then the steps of setting up by hand. */
export type DepthStep = 'start' | 'scan' | 'surfaces' | 'faces' | 'down' | 'projector';

/** What the stage shows and does during depth setup. */
export type DepthStage = {
  step: DepthStep;
  /** Down on the output (x right, y down). */
  arrow: Point;
  elevation: number;
  /** Each solid object's role, guessed or chosen. */
  roles: Record<string, 'top' | 'side' | 'backdrop'>;
};
