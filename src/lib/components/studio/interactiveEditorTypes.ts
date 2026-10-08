/** Small types shared by the Interactive Studio editor components. */

/** Select (edit shapes), Draw (outline a new shape) or Play (touch the simulation). */
export type EditorMode = 'perform' | 'draw' | 'edit';

/** Inspector tabs: Scenes, Effects, Objects, Setup. */
export type InspectorTab = 'presets' | 'effects' | 'objects' | 'scene';

/** What a touch does to the simulation in Play mode. */
export type TouchTool = 'attract' | 'repel' | 'vortex';

/** The emitter or light marker drawn on the stage, in normalised 0–1 coordinates. */
export type EmitterMarker = { x: number; y: number; label: string };
