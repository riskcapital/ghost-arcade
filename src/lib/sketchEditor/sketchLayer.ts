/**
 * A sketch layer's source with new code.
 *
 * The page's controls are read again from the new code, so a control the
 * code adds appears at once and one it removes goes away. Where the user has
 * moved a slider, that value stays, unless the edit changed the value the
 * code itself starts the control at: then the code wins, because that is the
 * change the user just made.
 */
import { jsAnimationFromHtml } from '../renderer/jsAnimationPage';
import type { JSAnimationParamValue, JSAnimationSource } from '../types';

function same(a: JSAnimationParamValue | undefined, b: JSAnimationParamValue | undefined): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => v === b[i]);
  return a === b;
}

function codeValues(html: string): Record<string, JSAnimationParamValue> {
  const parsed = jsAnimationFromHtml(html);
  const values: Record<string, JSAnimationParamValue> = {};
  for (const param of parsed.params ?? []) values[param.name] = parsed.paramValues?.[param.name] ?? param.default;
  return values;
}

export function sketchWithCode(current: JSAnimationSource, code: string): JSAnimationSource {
  if (current.htmlCode === code) return current;
  const parsed = jsAnimationFromHtml(code);
  const before = codeValues(current.htmlCode);
  const now = codeValues(code);
  const paramValues: Record<string, JSAnimationParamValue> = {};
  for (const param of parsed.params ?? []) {
    const set = current.paramValues?.[param.name];
    const fromCode = now[param.name];
    paramValues[param.name] = set !== undefined && param.name in before && same(before[param.name], fromCode) ? set : fromCode;
  }
  return {
    ...current,
    animationType: parsed.animationType,
    htmlCode: code,
    params: parsed.params,
    paramValues: parsed.params ? paramValues : undefined,
  };
}

interface LayerLike {
  id: string;
  source?: { id: string; jsAnimation?: unknown } | null;
}

/**
 * The layers the editor changes when it opens on `layerId`: that layer
 * first, then every other layer playing the same source. A duplicated layer
 * keeps its source's id, and whatever plays a source follows the code the
 * source holds, so copies left with the old code would swap the page back
 * and forth every frame.
 */
export function layersPlayingSource(layers: LayerLike[], layerId: string): string[] {
  const layer = layers.find((l) => l.id === layerId);
  const sourceId = layer?.source?.jsAnimation ? layer.source.id : null;
  if (!layer || !sourceId) return [];
  return [layer.id, ...layers.filter((l) => l.id !== layer.id && l.source?.jsAnimation && l.source.id === sourceId).map((l) => l.id)];
}
