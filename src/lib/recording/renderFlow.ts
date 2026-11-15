/**
 * Render to video as one explicit state:
 *
 *   idle → preparing → rendering → encoding → done
 *                                          ↘ cancelled | error (from any running state)
 *
 * The browser fallback encodes in segments, so rendering and encoding may
 * alternate. Cancel does not jump straight to "cancelled": the running
 * state is marked `stopping` while the render cleans up (temp frames, the
 * encoder, the sound file), and only then does `cancelled` arrive — a new
 * render cannot start on top of one that is still tidying up.
 */

export type PrepareStep = 'folder' | 'encoder' | 'sound' | 'output';
export type EncodeStep = 'video' | 'sound' | 'saving';

export type RenderFlow =
  | { kind: 'idle' }
  | { kind: 'preparing'; step: PrepareStep; stopping: boolean }
  | { kind: 'rendering'; frame: number; total: number; stopping: boolean }
  | { kind: 'encoding'; step: EncodeStep; progress: number; stopping: boolean }
  | { kind: 'done' }
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string };

export type RenderEvent =
  | { type: 'start' }
  | { type: 'prepare'; step: PrepareStep }
  | { type: 'frame'; frame: number; total: number }
  | { type: 'encode'; step: EncodeStep; progress?: number }
  | { type: 'finish' }
  | { type: 'stop' }
  | { type: 'stopped' }
  | { type: 'fail'; message: string }
  | { type: 'reset' };

export const IDLE: RenderFlow = { kind: 'idle' };

export function isRunning(flow: RenderFlow): flow is Extract<RenderFlow, { stopping: boolean }> {
  return flow.kind === 'preparing' || flow.kind === 'rendering' || flow.kind === 'encoding';
}

/** Every transition. Anything not listed leaves the state as it is. */
export function renderStep(flow: RenderFlow, event: RenderEvent): RenderFlow {
  const running = isRunning(flow);
  const stopping = running && flow.stopping;
  switch (event.type) {
    case 'start':
      return running ? flow : { kind: 'preparing', step: 'output', stopping: false };
    case 'prepare':
      return running && flow.kind !== 'rendering' ? { kind: 'preparing', step: event.step, stopping } : flow;
    case 'frame':
      if (!running) return flow;
      return { kind: 'rendering', frame: Math.max(0, Math.min(event.frame, event.total)), total: Math.max(0, event.total), stopping };
    case 'encode':
      if (!running || flow.kind === 'preparing') return flow;
      return { kind: 'encoding', step: event.step, progress: Math.max(0, Math.min(1, event.progress ?? 0)), stopping };
    case 'finish':
      // A stop that came in too late to stop anything: the file is made, keep it.
      return running && flow.kind !== 'preparing' ? { kind: 'done' } : flow;
    case 'stop':
      return running ? { ...flow, stopping: true } : flow;
    case 'stopped':
      return running ? { kind: 'cancelled' } : flow;
    case 'fail':
      return running ? { kind: 'error', message: event.message || 'The render failed' } : flow;
    case 'reset':
      return running ? flow : IDLE;
  }
}
