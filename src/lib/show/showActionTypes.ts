/**
 * What a show action is, without the app's stores: the type that scenes,
 * zones and phones store and send. `showActions.ts` fires them; this file
 * only describes them, so pure models (an interactive scene's trigger zones,
 * the phone's editor) can hold one without pulling in the desktop runtime.
 */

/** A source a Timeline row can be handed to. */
export type ShowTakeoverSourceSpec =
  | { kind: 'vjRow'; deck: 'A' | 'B'; row: number }
  | { kind: 'vjMix' }
  | { kind: 'vjGroup'; index: number }
  | { kind: 'black' };

export type ShowAction =
  /** A shape Look on the shapes: every shape, or `layerIds`. Palette: the Look's own unless given. */
  | { kind: 'look'; lookId: string; paletteId?: string; layerIds?: string[] }
  /** Recall a mapping preset (composition), with the tray's transition when it is open. */
  | { kind: 'preset'; compositionId: string }
  /** A VJ clip: row and column from 0, deck A unless given. Waits for the VJ launch quantise. */
  | { kind: 'clip'; deck?: 'A' | 'B'; row: number; column: number }
  /** A VJ column, from 0. */
  | { kind: 'clipColumn'; deck?: 'A' | 'B'; column: number }
  /** A clip in Live: track and slot from 0 (Live's launch quantise). */
  | { kind: 'liveClip'; track: number; slot: number }
  /** A scene in Live, from 0. */
  | { kind: 'liveScene'; scene: number }
  /** Jump to a Timeline section, by id, name or position (from 0). Playing, it plays on from there. */
  | { kind: 'section'; id?: string; name?: string; index?: number }
  /** GO. */
  | { kind: 'go' }
  | { kind: 'transport'; op: 'play' | 'pause' | 'stop' | 'toggle' | 'seek'; seconds?: number }
  /** Launch a phrase on the next bar: its pad (from 1) or its section id. `stop`: stop the phrases on the next bar. */
  | { kind: 'phrase'; pad?: number; sectionId?: string; stop?: boolean }
  /** Hand a row to the VJ decks: `track` is the row as numbered on the Timeline (from 0) or a row id. */
  | { kind: 'takeover'; track: number | string; source: ShowTakeoverSourceSpec }
  /** Hand a row back (with the takeover's release setting); no `track`: every row. */
  | { kind: 'release'; track?: number | string | null }
  /** Blackout on or off; no `on`: toggle. */
  | { kind: 'blackout'; on?: boolean }
  /** The cue list. `fire`: cue `index` (from 0). */
  | { kind: 'cue'; op: 'go' | 'back' | 'stop' | 'reset' | 'fire'; index?: number };

export type ShowActionKind = ShowAction['kind'];
