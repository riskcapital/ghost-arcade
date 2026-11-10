/**
 * "◆" next to a control in the normal panels: a point at the playhead on
 * that control's line (the line is made if it has none), holding the value
 * the control shows.
 *
 * Controls are found by what they already carry: their MIDI-learn path
 * (`data-midi-path`, e.g. `map:shader:speed`), or an explicit
 * `data-line-key` (+ `data-line-scope` / `data-line-target`) where there is
 * no path (sketch controls, the look block bar). Panel controls act on the
 * selected piece; with a Timeline block selected (SHOW BLOCK), its media's
 * own controls act on that block.
 */
import { writable } from 'svelte/store';
import { isBlockKey, type ParamTarget } from '../../../timeline/lines/paramRegistry';

/** The last control picked with ◆ (what "Bind" binds when no line is selected). */
export const lastLineControl = writable<{ target: ParamTarget; key: string; label: string } | null>(null);

export interface ControlAddress {
  scope: 'piece' | 'stage' | 'look' | 'block';
  key: string;
  /** For look / block scopes given on the element. */
  id?: string;
}

/** The line key a panel control's MIDI path stands for, or null. */
export function lineKeyForControlPath(path: string): ControlAddress | null {
  const p = path.trim();
  if (!p.startsWith('map:')) return null;
  const parts = p.split(':');
  const kind = parts[1];
  const rest = parts.slice(2);
  if (!rest.length || rest.some((x) => x === '')) return null;
  switch (kind) {
    case 'layer':
      return rest[0] === 'opacity' ? { scope: 'piece', key: 'layer:opacity' } : null;
    case 'shader':
      return { scope: 'piece', key: `shader:${rest.join(':')}` };
    case 'gpu':
      return { scope: 'piece', key: `gpu:${rest.join(':')}` };
    case 'splat':
      return { scope: 'piece', key: `splat:${rest.join(':')}` };
    case 'model3d':
      return { scope: 'piece', key: `model3d:${rest.join(':')}` };
    case 'edge':
      return rest.length >= 2 ? { scope: 'piece', key: `edge:${rest[0]}:${rest.slice(1).join(':')}` } : null;
    case 'effect':
      return rest.length >= 2 ? { scope: 'piece', key: `fx:${rest[0]}:${rest.slice(1).join(':')}` } : null;
    case 'stage-effect':
      return rest.length >= 2 && rest[1] !== 'hold' ? { scope: 'stage', key: `stage:fx:${rest[0]}:${rest.slice(1).join(':')}` } : null;
    default:
      return null;
  }
}

/** What a panel element stands for: its explicit line key, else its MIDI path. */
export function controlAddressOf(el: Element): ControlAddress | null {
  const key = el.getAttribute('data-line-key');
  if (key) {
    const scope = (el.getAttribute('data-line-scope') ?? 'piece') as ControlAddress['scope'];
    const id = el.getAttribute('data-line-target') ?? undefined;
    return { scope, key, ...(id ? { id } : {}) };
  }
  const path = el.getAttribute('data-midi-path');
  return path ? lineKeyForControlPath(path) : null;
}

/**
 * The line target for a control: the Stage, a look block, the selected
 * block (for its media's own keys) or the selected piece. Null when
 * nothing is selected for a piece control.
 */
export function resolveControlTarget(
  address: ControlAddress,
  ctx: { selectedLayerId: string | null; activeBlockClipId: string | null },
): ParamTarget | null {
  if (address.scope === 'stage') return { scope: 'stage' };
  if (address.scope === 'look') return address.id ? { scope: 'look', id: address.id } : null;
  if (address.scope === 'block') return address.id ? { scope: 'block', id: address.id } : ctx.activeBlockClipId ? { scope: 'block', id: ctx.activeBlockClipId } : null;
  if (ctx.activeBlockClipId && isBlockKey(address.key)) return { scope: 'block', id: ctx.activeBlockClipId };
  return ctx.selectedLayerId ? { scope: 'layer', id: ctx.selectedLayerId } : null;
}
