/**
 * Starter templates — ready-made projects a new user can open instead of a
 * blank screen. Each one is built from the shader library at the moment it
 * is chosen rather than stored as a project file, so a template always
 * matches the current project format and shader set.
 */
import { get } from 'svelte/store';
import { generateUUID } from '../utils/uuid';
import { project } from '../stores/layers';
import { vjClipLauncher, type VJClip, type VJDeck } from '../stores/vjClipLauncher';
import type { WarpCorners } from '../types';
import { parseISF } from '../isf/parser';
import { setParamModSource } from '../audio/modulation';
import { STYLE_SETS, loadShaderCode, shaderDisplayName, shaderUrl, thumbnailFor } from './deckLibrary';

export interface StarterTemplate {
  id: string;
  name: string;
  /** Who it is for, in a few words. */
  audience: string;
  description: string;
  /** Library shader shown as the card picture. */
  cover: string;
  mode: 'vj' | 'mapping';
}

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    id: 'band-stage',
    name: 'Band on stage',
    audience: 'Projecting across a band',
    description: 'Four blocks of concert lighting: beams and spots, washes and haze, backdrops and audio-reactive looks, with Performer on every block.',
    cover: 'STAGE-BeamRig.fs',
    mode: 'vj',
  },
  {
    id: 'club-vj',
    name: 'Club VJ set',
    audience: 'DJ nights and parties',
    description: 'Four blocks on two decks: flagship visuals, audio reactive, 3D rooms and glitch, with the crossfader on and launches locked to the bar.',
    cover: 'Featured-tide.fs',
    mode: 'vj',
  },
  {
    id: 'psychedelic',
    name: 'Psychedelic night',
    audience: 'Liquid light shows',
    description: 'Four blocks for a liquid light show: oil and lava, mandalas, cosmic and audio-reactive looks, with Performer on every block.',
    cover: 'PSY-OilWheel.fs',
    mode: 'vj',
  },
  {
    id: 'mapping-starter',
    name: 'Projection mapping starter',
    audience: 'Mapping onto objects and walls',
    description: 'Three surfaces with test patterns, ready to drag their corners onto your real objects.',
    cover: 'DM-TestPattern.fs',
    mode: 'mapping',
  },
];

/** Deck layouts: each block is one style. Rows 1-3 are the style, row 4
 *  borrows from a companion style, and the last cell of row 4 is the
 *  Performer. */
type BlockSpec = { name: string; style: string; companion: string };
const DECKS: Record<string, { crossfader?: boolean; blocks: BlockSpec[] }> = {
  'band-stage': {
    blocks: [
      { name: 'Beams & Spots', style: 'beams', companion: 'washes' },
      { name: 'Washes & Haze', style: 'washes', companion: 'beams' },
      { name: 'Backdrops', style: 'backdrops', companion: 'audio' },
      { name: 'Audio Reactive', style: 'audio', companion: 'beams' },
    ],
  },
  'club-vj': {
    crossfader: true,
    blocks: [
      { name: 'Flagship', style: 'flagship', companion: 'audio' },
      { name: 'Audio Reactive', style: 'audio', companion: 'flagship' },
      { name: '3D Rooms', style: 'rooms', companion: 'geometric' },
      { name: 'Geometric & Glitch', style: 'geometric', companion: 'rooms' },
    ],
  },
  psychedelic: {
    blocks: [
      { name: 'Liquid Light', style: 'liquid', companion: 'mandala' },
      { name: 'Mandalas', style: 'mandala', companion: 'liquid' },
      { name: 'Cosmic', style: 'cosmic', companion: 'audio' },
      { name: 'Audio Reactive', style: 'audio', companion: 'liquid' },
    ],
  },
};

const DECK_ROWS = 4;
const DECK_COLUMNS = 8;

/** The cells of one block, row by row; null where the Performer goes. */
function blockCells(spec: BlockSpec, offset = 0): Array<string | null> {
  const rotate = (list: string[]) => list.slice(offset).concat(list.slice(0, offset));
  const main = rotate(STYLE_SETS[spec.style] ?? []).slice(0, (DECK_ROWS - 1) * DECK_COLUMNS);
  const extra = rotate(STYLE_SETS[spec.companion] ?? []).filter((n) => !main.includes(n)).slice(0, DECK_COLUMNS - 1);
  return [...main, ...extra, null];
}

// Parameters that read as "how hard is it hitting" follow the bass; a
// colour or hue control follows the mids. Speed and position are left
// alone, since tying them to the music makes motion jitter.
const BASS_PARAM = /glow|intens|bright|energy|pulse|flash|haze|strength|exposure|power|bloom/i;
const MID_PARAM = /hue|colou?r(shift|offset|cycle)|spectrum/i;

function makeAudioReactive(clip: VJClip, row: number, deck: VJDeck) {
  if (!clip.shaderCode) return;
  let inputs: any[] = [];
  try { inputs = parseISF(clip.shaderCode).metadata.INPUTS ?? []; } catch { return; }
  const floats = inputs.filter((i) => i.TYPE === 'float' && typeof i.MIN === 'number' && typeof i.MAX === 'number');
  const bass = floats.find((i) => BASS_PARAM.test(i.NAME) || BASS_PARAM.test(i.LABEL ?? ''));
  const mid = floats.find((i) => i !== bass && (MID_PARAM.test(i.NAME) || MID_PARAM.test(i.LABEL ?? '')));
  for (const [input, source] of [[bass, 'bass'], [mid, 'mid']] as const) {
    if (!input) continue;
    const value = typeof input.DEFAULT === 'number' ? input.DEFAULT : (input.MIN + input.MAX) / 2;
    setParamModSource(row, input.NAME, source, deck, 'vj', clip.id, { value, min: input.MIN, max: input.MAX });
  }
}

async function shaderClip(name: string): Promise<VJClip | null> {
  const [code, thumbnail] = await Promise.all([loadShaderCode(name), thumbnailFor(name)]);
  if (!code) return null;
  return {
    id: generateUUID(),
    type: 'shader',
    name: shaderDisplayName(name),
    src: shaderUrl(name),
    thumbnail,
    shaderCode: code,
    shaderValues: {},
  };
}

function performerClip(): VJClip {
  return { id: generateUUID(), type: 'synthvision', name: 'Performer', src: 'performer', effects: [] } as VJClip;
}

async function fillBlock(spec: BlockSpec, deck: VJDeck, offset = 0): Promise<void> {
  const cells = blockCells(spec, offset);
  const clips = await Promise.all(cells.map((name) => (name ? shaderClip(name) : Promise.resolve(performerClip()))));
  clips.forEach((clip, index) => {
    if (!clip) return;
    const row = Math.floor(index / DECK_COLUMNS);
    const column = index % DECK_COLUMNS;
    vjClipLauncher.setClip(row, column, clip, deck);
    makeAudioReactive(clip, row, deck);
  });
}

function shaderName(file: string): string {
  const base = file.replace(/\.fs$/, '').replace(/^(STAGE|GA2|PSY|DM|Featured)-/, '');
  return base.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
}

export function templateCoverUrl(template: StarterTemplate): string {
  return `./ISF/thumbnails/${encodeURIComponent(template.cover.replace(/\.fs$/, '.jpg'))}`;
}

async function loadShader(base: string): Promise<{ src: string; code: string; thumbnail: string } | null> {
  const file = `${base}.fs`;
  const src = `./ISF/${encodeURIComponent(file)}`;
  try {
    const response = await fetch(src);
    if (!response.ok) return null;
    return { src, code: await response.text(), thumbnail: `./ISF/thumbnails/${encodeURIComponent(`${base}.jpg`)}` };
  } catch {
    return null;
  }
}

async function fillDeck(rows: string[][], deck: VJDeck, firstRow = 0): Promise<void> {
  for (const [offset, row] of rows.entries()) {
    const rowIndex = firstRow + offset;
    for (const [column, base] of row.entries()) {
      if (!base) continue;
      const shader = await loadShader(base);
      if (!shader) continue;
      const clip: VJClip = {
        id: generateUUID(),
        type: 'shader',
        name: shaderName(base),
        src: shader.src,
        thumbnail: shader.thumbnail,
        shaderCode: shader.code,
        shaderValues: {},
      };
      vjClipLauncher.setClip(rowIndex, column, clip, deck);
    }
  }
}

/** Put one library shader into a deck cell (used by the guided tour). */
export async function addLibraryShaderToDeck(base: string, row: number, column: number, deck: VJDeck = 'A'): Promise<boolean> {
  await fillDeck([[...Array(column).fill(''), base]], deck, row);
  return !!get(vjClipLauncher)[deck === 'B' ? 'bankBClipGrid' : 'clipGrid'][row]?.[column];
}

function region(x0: number, x1: number, y0: number, y1: number): WarpCorners {
  // Corner space is [0,1] with y = 1 at the top.
  return {
    topLeft: { x: x0, y: y1 },
    topRight: { x: x1, y: y1 },
    bottomLeft: { x: x0, y: y0 },
    bottomRight: { x: x1, y: y0 },
  } as WarpCorners;
}

/** Add one test-pattern surface for mapping (used by the guided tour). */
export async function addMappingSurface(name = 'Surface 1'): Promise<boolean> {
  const shader = await loadShader('DM-TestPattern');
  const id = project.addLayer(name, 'media');
  if (!id || !shader) return false;
  project.setLayerSource(id, {
    id: `DM-TestPattern-${id}`,
    type: 'shader',
    src: shader.src,
    name: shaderName('DM-TestPattern'),
    shaderCode: shader.code,
    shaderValues: {},
  } as any);
  project.updateLayer(id, { corners: region(0.25, 0.75, 0.22, 0.78) });
  return true;
}

async function buildMappingStarter(): Promise<void> {
  const surfaces: Array<[string, string, WarpCorners]> = [
    ['Surface 1', 'DM-TestPattern', region(0.06, 0.36, 0.3, 0.75)],
    ['Surface 2', 'DM-UVGrid', region(0.4, 0.62, 0.15, 0.85)],
    ['Surface 3', 'DM-GridMatrix', region(0.66, 0.94, 0.35, 0.7)],
  ];
  for (const [name, base, corners] of surfaces) {
    const shader = await loadShader(base);
    const id = project.addLayer(name, 'media');
    if (!id || !shader) continue;
    project.setLayerSource(id, {
      id: `${base}-${id}`,
      type: 'shader',
      src: shader.src,
      name: shaderName(base),
      shaderCode: shader.code,
      shaderValues: {},
    } as any);
    project.updateLayer(id, { corners });
  }
}

/**
 * Open a template. `startFresh` clears the current project the same way
 * File → New does, so nothing from the previous project leaks in.
 */
export async function applyStarterTemplate(id: string, startFresh: (name: string) => void): Promise<boolean> {
  const template = STARTER_TEMPLATES.find((t) => t.id === id);
  if (!template) return false;
  startFresh(template.name);
  if (template.mode === 'mapping') {
    vjClipLauncher.setOpen(false);
    await buildMappingStarter();
    return true;
  }
  const layout = DECKS[id];
  while (get(vjClipLauncher).numLayers < DECK_ROWS) vjClipLauncher.addLayer();
  while (get(vjClipLauncher).numColumns < DECK_COLUMNS) vjClipLauncher.addColumn();
  vjClipLauncher.setCrossfaderEnabled(!!layout.crossfader);
  vjClipLauncher.setQuantization(layout.crossfader ? '1bar' : '1/4');
  for (const [index, spec] of layout.blocks.entries()) {
    const state = get(vjClipLauncher);
    if (index === 0) {
      vjClipLauncher.renameBlock(state.activeBlockId, spec.name);
    } else {
      vjClipLauncher.addBlock(spec.name);
      const created = get(vjClipLauncher).blocks.at(-1);
      if (created) vjClipLauncher.setActiveBlock(created.id);
    }
    await fillBlock(spec, 'A');
    // Deck B gets the same style, starting further along the list, so the
    // two decks never hold the same look side by side.
    if (layout.crossfader) await fillBlock(spec, 'B', 12);
  }
  const first = get(vjClipLauncher).blocks[0];
  if (first) vjClipLauncher.setActiveBlock(first.id);
  vjClipLauncher.setOpen(true);
  return true;
}
