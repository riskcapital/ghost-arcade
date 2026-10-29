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
