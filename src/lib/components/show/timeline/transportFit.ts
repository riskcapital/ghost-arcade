/**
 * Keeps the show transport on one line: when its controls wrap, step the
 * transport's fit level up (shorter labels, icons, a popover) until they fit
 * or the last level is reached; past that the row still wraps. Re-runs when
 * the transport changes width or controls come and go (a takeover's pill,
 * the countdown, the audio controls), starting again from the roomiest level.
 */
import { tick } from 'svelte';

/** How many lines the element's visible children sit on. */
export function lineCount(node: Element): number {
  const boxes = [...node.children]
    .map((child) => child.getBoundingClientRect())
    .filter((r) => r.width > 0 && r.height > 0)
    .sort((a, b) => a.top - b.top);
  if (!boxes.length) return 0;
  let lines = 1;
  let lineBottom = boxes[0].bottom;
  for (const r of boxes.slice(1)) {
    if (r.top >= lineBottom) {
      lines++;
      lineBottom = r.bottom;
    } else {
      lineBottom = Math.min(lineBottom, r.bottom);
    }
  }
  return lines;
}

/** Does this change move controls? Comment anchors and nodes marked
 *  `data-fit-ignore` (a popover floating over the tray) do not. */
export function mutationMovesControls(record: Pick<MutationRecord, 'addedNodes' | 'removedNodes'>): boolean {
  for (const list of [record.addedNodes, record.removedNodes]) {
    for (const n of Array.from(list)) {
      if (n.nodeType === 8) continue;
      if (n.nodeType === 1 && (n as Element).hasAttribute('data-fit-ignore')) continue;
      return true;
    }
  }
  return false;
}

/**
 * The first level, from 0 up to `max`, at which everything sits on one line.
 * When even `max` cannot do that, the roomiest level that needs no more lines
 * than `max` does (tightening that saves no line is not worth its labels).
 */
export async function findFit(max: number, apply: (level: number) => Promise<void> | void, lines: () => number): Promise<number> {
  let level = 0;
  await apply(level);
  while (level < max && lines() > 1) {
    level++;
    await apply(level);
  }
  const fewest = lines();
  if (fewest <= 1) return level;
  for (let roomier = 0; roomier < max; roomier++) {
    await apply(roomier);
    if (lines() <= fewest) return roomier;
  }
  await apply(max);
  return max;
}

export interface TransportFitOptions {
  max: number;
  set: (level: number) => void;
}

export function transportFit(node: HTMLElement, options: TransportFitOptions) {
  let opts = options;
  let fitting = false;
  let queued = false;
  let lastWidth = -1;
  let destroyed = false;

  const run = async () => {
    if (fitting || destroyed) return;
    fitting = true;
    try {
      await findFit(opts.max, async (level) => { opts.set(level); await tick(); }, () => lineCount(node));
    } finally {
      // Our own label and popover changes are not a reason to fit again.
      mutations?.takeRecords();
      fitting = false;
    }
  };
  const schedule = () => {
    if (queued || destroyed) return;
    queued = true;
    queueMicrotask(() => { queued = false; void run(); });
  };

  const resize = typeof ResizeObserver === 'function'
    ? new ResizeObserver((entries) => {
      const width = Math.round(entries[entries.length - 1].contentRect.width);
      if (width === lastWidth) return;
      lastWidth = width;
      schedule();
    })
    : null;
  resize?.observe(node);
  // Controls coming and going (not text changing: the clock and the
  // countdown tick without moving anything else).
  const mutations: MutationObserver | null = typeof MutationObserver === 'function'
    ? new MutationObserver((records) => { if (!fitting && records.some(mutationMovesControls)) schedule(); })
    : null;
  mutations?.observe(node, { childList: true, subtree: true });
  schedule();

  return {
    update(next: TransportFitOptions) { opts = next; },
    destroy() {
      destroyed = true;
      resize?.disconnect();
      mutations?.disconnect();
    },
  };
}
