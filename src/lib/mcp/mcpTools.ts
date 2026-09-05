import { get } from 'svelte/store';
import { midiRouter } from '../midi/midiRouter';
import { normalizeControlPath, validateControlPath, CONTROL_PATH_EXAMPLES } from '../control/controlPaths';
import { readControlPath } from '../osc/oscFeedback';
import { vjClipLauncher } from '../stores/vjClipLauncher';
import { project } from '../stores/layers';
import { getNativeRendererOutputSharedTextureSnapshot } from '../api/native-renderer';

/**
 * The tool surface an external AI client drives Ghost Arcade through.
 *
 * Built on the control-path vocabulary rather than a bespoke set of verbs. The
 * router already understands ~30 families of path: layer opacity, blend, solo,
 * mute, video transport, clip and column triggers, crossfader, effects, shader
 * and plugin params. MIDI and OSC both dispatch through it. Giving a model the
 * same vocabulary means it reaches everything a controller can reach, and
 * anything added later for a hardware surface arrives here for free.
 *
 * The alternative, a hand-written tool per operation, is what Director did:
 * fourteen verbs covering a fraction of the app, which stopped being true the
 * moment the app moved on.
 */

export interface McpToolResult {
  /** Text content for the model. */
  text?: string;
  /** Base64 PNG, when the tool returns an image. */
  imageBase64?: string;
  isError?: boolean;
}

/** Control paths worth showing a model up front, grouped so it can generalize. */
function controlVocabulary(): Record<string, unknown> {
  const state = get(vjClipLauncher) as any;
  return {
    syntax: 'scope:target:property, e.g. vj:0:opacity. Deck A is vj:, deck B is vj-b:.',
    note: 'Indices in control paths are ZERO-based, unlike the OSC addresses, '
      + 'which are one-based for humans.',
    deck: { layers: state?.numLayers ?? 4, columns: state?.numColumns ?? 8 },
    families: {
      'vj:<layer>:opacity': '0..1',
      'vj:<layer>:blend': '0..1 across the blend-mode list',
      'vj:<layer>:solo': 'trigger, >0 toggles',
      'vj:<layer>:mute': 'trigger, >0 toggles',
      'vj:<layer>:trigger:<column>': 'fire one clip',
      'vj:<layer>:video:play': 'trigger, toggles play/pause',
      'vj:<layer>:video:restart': 'trigger',
      'vj:<layer>:video:position': '0..1 across the trimmed clip',
      'vj:column:<column>': 'fire a whole column across every layer',
      'vj:block:<index>': 'switch block',
      'vj:snapshot:<1-16>': 'recall a snapshot',
      'vj:master:opacity': '0..1',
      'vj:crossfader:value': '0..1, A to B',
      'vj:tempo': 'BPM',
      'vj:stopall': 'trigger, stops all clips',
      'map:preset:<index>': 'recall a mapping preset',
      'map:layer:opacity': '0..1 on the selected mapping layer',
      'map:media:position': '0..1 playhead on the selected media',
    },
    examples: CONTROL_PATH_EXAMPLES,
  };
}

/**
 * What is loaded and what is playing.
 *
 * Deliberately a summary rather than the whole project: a model that has to
 * read thousands of lines of layer state before it can act spends its context
 * on bookkeeping. Anything finer is one read_control away.
 */
function appState(): Record<string, unknown> {
  const vj = get(vjClipLauncher) as any;
  const proj = get(project) as any;

  const describeDeck = (layerStates: any[], grid: any[][]) =>
    (layerStates ?? []).map((ls, index) => ({
      layer: index,
      opacity: ls?.opacity ?? 1,
      blendMode: ls?.blendMode,
      solo: !!ls?.solo,
      mute: !!ls?.mute,
      activeColumn: ls?.activeColumn ?? null,
      playing: ls?.activeClip ? { name: ls.activeClip.name, type: ls.activeClip.type } : null,
      clips: (grid?.[index] ?? [])
        .map((clip: any, column: number) => (clip ? { column, name: clip.name, type: clip.type } : null))
        .filter(Boolean),
    }));

  return {
    project: { name: proj?.name, width: proj?.width, height: proj?.height },
    mode: vj?.isOpen ? 'vj' : 'mapping',
    master: { opacity: vj?.masterOpacity ?? 1 },
    crossfader: { enabled: !!vj?.crossfaderEnabled, value: vj?.crossfaderValue ?? 0.5 },
    deckA: describeDeck(vj?.layerStates, vj?.clipGrid),
    deckB: describeDeck(vj?.bankBLayerStates, vj?.bankBClipGrid),
  };
}

/**
 * A frame of what is actually on the output.
 *
 * A model that can set values but cannot see the result is working blind on a
 * visual instrument: it can be told a layer sits at 0.8 opacity and still have
 * no idea whether the composition reads. Every other tool here is worth more
 * once this one exists.
 */
async function outputFrame(): Promise<McpToolResult> {
  let snapshot: any;
  try {
    snapshot = await getNativeRendererOutputSharedTextureSnapshot({ include_pixels: true });
  } catch (err) {
    // The export target only exists while something is actually being output.
    // Saying so is far more use than the raw RPC error, because the fix is a
    // thing the user does, not a bug.
    return {
      text: 'No output surface is active, so there is no frame to capture. '
        + 'Open an output window (or start a Syphon/NDI/Spout sender) and try again. '
        + `Renderer said: ${(err as Error)?.message ?? err}`,
      isError: true,
    };
  }
  if (!snapshot) {
    return { text: 'No output frame available; the native renderer may not be running.', isError: true };
  }

  const pixels = snapshot.pixels;
  const { width, height } = snapshot;
  if (!pixels || !width || !height) {
    return {
      text: 'The output snapshot came back without pixels. This usually means no '
        + 'output surface is active yet.',
      isError: true,
    };
  }
  if (typeof document === 'undefined') {
    return { text: 'Frame capture needs a renderer context.', isError: true };
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { text: 'Could not create a 2D context to encode the frame.', isError: true };

  const bytes = pixels instanceof Uint8Array ? pixels : new Uint8Array(pixels as number[]);
  // The readback is row-padded for GPU alignment, so copy row by row rather than
  // assuming a width*4 stride. Assuming it shears the image.
  const stride = snapshot.padded_bytes_per_row || width * 4;
  // The output export is bgra8unorm. Handing BGRA to putImageData swaps red and
  // blue, which is the worst kind of wrong here: the image looks fine, so a
  // model reasoning about colour is confidently misled rather than blocked.
  const isBgra = String(snapshot.storage_format ?? snapshot.format ?? '').toLowerCase().includes('bgra');
  const image = ctx.createImageData(width, height);
  for (let y = 0; y < height; y += 1) {
    const from = y * stride;
    const to = y * width * 4;
    if (isBgra) {
      for (let x = 0; x < width; x += 1) {
        const s = from + x * 4;
        const d = to + x * 4;
        image.data[d] = bytes[s + 2];
        image.data[d + 1] = bytes[s + 1];
        image.data[d + 2] = bytes[s];
        image.data[d + 3] = bytes[s + 3];
      }
    } else {
      image.data.set(bytes.subarray(from, from + width * 4), to);
    }
  }
  ctx.putImageData(image, 0, 0);

  return {
    text: `Output frame, ${width}x${height}.`,
    imageBase64: canvas.toDataURL('image/png').split(',')[1],
  };
}

export const MCP_TOOL_NAMES = [
  'get_state',
  'list_controls',
  'set_control',
  'read_control',
  'get_output_frame',
] as const;

export async function executeMcpTool(
  name: string,
  input: Record<string, unknown>,
): Promise<McpToolResult> {
  switch (name) {
    case 'get_state':
      return { text: JSON.stringify(appState(), null, 1) };

    case 'list_controls':
      return { text: JSON.stringify(controlVocabulary(), null, 1) };

    case 'read_control': {
      const path = normalizeControlPath(String(input.path ?? ''));
      const value = readControlPath(path);
      return value === null
        ? { text: `No readable value for "${path}". Not every path can be read back.` }
        : { text: String(value) };
    }

    case 'set_control': {
      const raw = String(input.path ?? '');
      const validation = validateControlPath(raw);
      if (!validation.valid) {
        // Hand back the reason rather than failing silently: a model can correct
        // a malformed path if it is told what was wrong with it.
        return { text: `Invalid control path "${raw}": ${validation.reason}`, isError: true };
      }
      const value = Number(input.value);
      if (!Number.isFinite(value)) return { text: 'value must be a number.', isError: true };

      midiRouter.dispatchPath(validation.normalized, value);
      return { text: `Set ${validation.normalized} to ${value}.` };
    }

    case 'get_output_frame':
      return outputFrame();

    default:
      return { text: `Unknown tool: ${name}`, isError: true };
  }
}
