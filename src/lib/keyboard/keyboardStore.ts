/**
 * Keyboard control mapping — the third control surface alongside MIDI
 * and OSC.
 *
 * Architecture mirrors oscStore: this store owns a bindings table
 * (key combo → param path) and dispatches every match through
 * `midiRouter.dispatchPath`, the same router MIDI and OSC use. So every
 * MIDI-mappable param path gets keyboard control for free.
 *
 * The source here is discrete (key down / up) rather than a continuous
 * fader, so each binding carries an *action mode* that decides what
 * value gets dispatched:
 *   - trigger:   keydown fires `value` (default 1). For note-trigger
 *                paths like vj:column:N, vj:stopall, sv:clip:N.
 *   - toggle:    keydown flips between `min` and `max` (solo/mute/bools).
 *   - momentary: keydown → `max`, keyup → `min` (hold to activate).
 *   - nudge:     keydown adds `step` (may be negative) to a running
 *                accumulator, clamped to [min,max] — bind two keys with
 *                opposite-sign steps to ride a continuous param up/down.
 *
 * Unlike OSC this needs no Electron bridge — the window keydown/keyup
 * listeners work in the browser build too. We arm them only while
 * `enabled` so we never shadow the app's own shortcuts when off.
 *
 * State is persisted with the project (see exportProject / importProject
 * in src/lib/stores/layers.ts) so keyboard routing survives reload.
 */

import { writable, get, derived } from 'svelte/store';
import { midiRouter } from '../midi/midiRouter';
import { generateUUID } from '../utils/uuid';
import { synthVisionStore } from '../stores/synthVision';

export type KeyActionMode = 'trigger' | 'toggle' | 'momentary' | 'nudge';

export interface KeyBinding {
  id: string;
  /** KeyboardEvent.code — layout-independent (e.g. 'KeyA', 'Digit1',
   *  'Space', 'ArrowUp'). */
  code: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  /** Param path forwarded to midiRouter.dispatchPath (same strings the
   *  MIDI router uses, e.g. 'vj:layer:0:opacity'). */
  path: string;
  mode: KeyActionMode;
  /** Off value (toggle) / floor (nudge) / momentary release value. */
  min: number;
  /** On value (toggle, momentary) / ceil (nudge). */
  max: number;
  /** Nudge increment per press — negative for a "decrease" key. */
  step: number;
  /** Value dispatched by a trigger press (defaults to max). */
  value: number;
  label?: string;
  /** For discrete-cycle params (blend mode, transition) — passed through
   *  to dispatchPath so named values resolve correctly. */
  discreteValues?: string[];
}

export interface KeyboardState {
  enabled: boolean;
  editMode: boolean;
  bindings: KeyBinding[];
  /** Most recent captured key (for the learn banner + debug feed). */
  lastKey: { code: string; ctrl: boolean; shift: boolean; alt: boolean; meta: boolean; at: number } | null;
  /** When set, the next keypress is bound to this param path instead of
   *  being dispatched normally. Auto-exits on capture. */
  learnTarget: {
    path: string;
    label?: string;
    mode?: KeyActionMode;
    min?: number;
    max?: number;
    step?: number;
    value?: number;
    discreteValues?: string[];
  } | null;
}

const INITIAL_STATE: KeyboardState = {
  enabled: false,
  editMode: false,
  bindings: [],
  lastKey: null,
  learnTarget: null,
};

const MODIFIER_CODES = new Set([
  'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight',
  'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight',
]);

/** Paths whose dispatch is a one-shot fire — learn defaults these to
 *  'trigger' instead of 'toggle'. Mirrors the note-trigger paths the
 *  MIDI router recognises. */
function looksLikeTrigger(path: string): boolean {
  return /:(column|clip|block|stage|preset|snapshot)\b/.test(path)
    || /:(stopall|spaceFx)$/.test(path)
    || path.endsWith(':trigger');
}

/** Render a binding (or captured event) as a human-readable combo,
 *  e.g. "⌘+Shift+A". Exported for the settings table. */
export function formatKeyCombo(b: Pick<KeyBinding, 'code' | 'ctrl' | 'shift' | 'alt' | 'meta'>): string {
  const mods: string[] = [];
  if (b.meta) mods.push('⌘');
  if (b.ctrl) mods.push('Ctrl');
  if (b.alt) mods.push('Alt');
  if (b.shift) mods.push('Shift');
  return [...mods, keyName(b.code)].join('+');
}

function keyName(code: string): string {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num' + code.slice(6);
  const map: Record<string, string> = {
    Space: 'Space', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    Enter: 'Enter', Escape: 'Esc', Backspace: '⌫', Tab: 'Tab',
    Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
    Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Backquote: '`',
  };
  return map[code] ?? code;
}

function matches(b: KeyBinding, e: KeyboardEvent): boolean {
  return b.code === e.code
    && b.ctrl === e.ctrlKey
    && b.shift === e.shiftKey
    && b.alt === e.altKey
    && b.meta === e.metaKey;
}

function isEditableTarget(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

function createKeyboardStore() {
  const { subscribe, update, set } = writable<KeyboardState>({ ...INITIAL_STATE });

  // Per-binding runtime accumulators — NOT persisted. toggle tracks the
  // current on/off; nudge tracks the running value.
  const toggleState = new Map<string, boolean>();
  const nudgeAccum = new Map<string, number>();

  let listening = false;

  function dispatch(b: KeyBinding, value: number) {
    midiRouter.dispatchPath(b.path, value, b.discreteValues ? { discreteValues: b.discreteValues } : {});
  }

  function onKeyDown(e: KeyboardEvent) {
    if (MODIFIER_CODES.has(e.code)) return;
    const state = get({ subscribe });

    // Learn mode — capture this combo for the pending target. We allow
    // capture even from a focused field so the user can learn right
    // after typing a path; normal dispatch (below) skips editable focus.
    if (state.learnTarget) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        update(s => ({ ...s, learnTarget: null, editMode: false }));
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      const mode: KeyActionMode = state.learnTarget.mode
        ?? (looksLikeTrigger(state.learnTarget.path) ? 'trigger' : 'toggle');
      const binding: KeyBinding = {
        id: generateUUID(),
        code: e.code,
        ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey,
        path: state.learnTarget.path,
        mode,
        min: state.learnTarget.min ?? 0,
        max: state.learnTarget.max ?? 1,
        step: state.learnTarget.step ?? 0.05,
        value: state.learnTarget.value ?? state.learnTarget.max ?? 1,
        label: state.learnTarget.label,
        discreteValues: state.learnTarget.discreteValues,
      };
      update(s => ({
        ...s,
        bindings: [...s.bindings, binding],
        learnTarget: null,
        lastKey: { code: e.code, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey, at: performance.now() },
      }));
      console.log('[Keyboard] learned binding:', formatKeyCombo(binding), '→', binding.path);
      return;
    }

    // The visible Performer surface owns its displayed keyboard. Keep
    // learn mode above this guard so users can still remap a key there.
    if (get(synthVisionStore).keyboardActive) return;

    if (isEditableTarget()) return;

    let consumed = false;
    for (const b of state.bindings) {
      if (!matches(b, e)) continue;
      // Auto-repeat would re-fire trigger/toggle while held — skip it
      // for those. momentary is already on; nudge intentionally repeats.
      if (e.repeat && b.mode !== 'nudge') continue;
      consumed = true;

      switch (b.mode) {
        case 'trigger':
          dispatch(b, b.value);
          break;
        case 'toggle': {
          const next = !(toggleState.get(b.id) ?? false);
          toggleState.set(b.id, next);
          dispatch(b, next ? b.max : b.min);
          break;
        }
        case 'momentary':
          dispatch(b, b.max);
          break;
        case 'nudge': {
          const start = b.step >= 0 ? b.min : b.max;
          const cur = nudgeAccum.get(b.id) ?? start;
          const nextVal = Math.max(Math.min(b.min, b.max), Math.min(Math.max(b.min, b.max), cur + b.step));
          nudgeAccum.set(b.id, nextVal);
          dispatch(b, nextVal);
          break;
        }
      }
    }
    if (consumed) {
      // A matched key acts as a dedicated control — swallow it so it
      // doesn't also trigger an app shortcut or scroll the page.
      e.preventDefault();
      e.stopPropagation();
    }
  }

  function onKeyUp(e: KeyboardEvent) {
    if (MODIFIER_CODES.has(e.code)) return;
    if (get(synthVisionStore).keyboardActive) return;
    if (isEditableTarget()) return;
    const state = get({ subscribe });
    for (const b of state.bindings) {
      if (b.mode !== 'momentary' || !matches(b, e)) continue;
      dispatch(b, b.min);
      e.preventDefault();
    }
  }

  function arm() {
    if (listening || typeof window === 'undefined') return;
    // Capture phase so we see the key before app-level shortcut handlers
    // and can swallow matched bindings.
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    listening = true;
  }

  function disarm() {
    if (!listening || typeof window === 'undefined') return;
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('keyup', onKeyUp, true);
    listening = false;
  }

  return {
    subscribe,

    setEnabled(enabled: boolean) {
      update(s => ({ ...s, enabled, learnTarget: enabled ? s.learnTarget : null }));
      if (enabled) arm(); else disarm();
    },
    toggleEditMode() {
      update(s => {
        const editMode = !s.editMode;
        if (editMode) arm();
        return {
          ...s,
          enabled: editMode ? true : s.enabled,
          editMode,
          learnTarget: editMode ? s.learnTarget : null,
        };
      });
    },
    setEditMode(editMode: boolean) {
      update(s => ({
        ...s,
        enabled: editMode ? true : s.enabled,
        editMode,
        learnTarget: editMode ? s.learnTarget : null,
      }));
      if (editMode) arm();
    },

    /** Begin learn mode. The next keypress becomes a binding for
     *  `targetPath`. Auto-exits on capture. Enables the listener so
     *  learn works even if the surface was off. */
    startLearn(
      targetPath: string,
      label?: string,
      mode?: KeyActionMode,
      defaults?: Partial<Pick<KeyBinding, 'min' | 'max' | 'step' | 'value' | 'discreteValues'>>
    ) {
      update(s => ({
        ...s,
        enabled: true,
        learnTarget: { path: targetPath, label, mode, ...defaults },
      }));
      arm();
    },
    cancelLearn() {
      update(s => ({ ...s, learnTarget: null }));
    },

    addBinding(binding: Omit<KeyBinding, 'id'>) {
      update(s => ({ ...s, bindings: [...s.bindings, { id: generateUUID(), ...binding }] }));
    },
    updateBinding(id: string, patch: Partial<KeyBinding>) {
      // A path/mode change invalidates the runtime accumulators.
      if ('path' in patch || 'mode' in patch || 'min' in patch || 'max' in patch) {
        toggleState.delete(id);
        nudgeAccum.delete(id);
      }
      update(s => ({ ...s, bindings: s.bindings.map(b => b.id === id ? { ...b, ...patch } : b) }));
    },
    removeBinding(id: string) {
      toggleState.delete(id);
      nudgeAccum.delete(id);
      update(s => ({ ...s, bindings: s.bindings.filter(b => b.id !== id) }));
    },

    /** Wholesale replace — used by importProject + reset(). */
    hydrate(state: Partial<KeyboardState>) {
      toggleState.clear();
      nudgeAccum.clear();
      const next: KeyboardState = {
        ...INITIAL_STATE,
        ...state,
        lastKey: null,
        learnTarget: null,
        editMode: false,
      };
      set(next);
      if (next.enabled) arm(); else disarm();
    },

    /** Serialize the persistent subset for project save. */
    serialize() {
      const s = get({ subscribe });
      return { enabled: s.enabled, bindings: s.bindings };
    },

    reset() {
      disarm();
      toggleState.clear();
      nudgeAccum.clear();
      set({ ...INITIAL_STATE });
    },
  };
}

export const keyboardStore = createKeyboardStore();

// Derived: count of bindings per path — for a "keyboard mapped" badge on
// parameter rows (parallels oscBindingsByPath).
export const keyBindingsByPath = derived(keyboardStore, $s => {
  const map = new Map<string, number>();
  for (const b of $s.bindings) map.set(b.path, (map.get(b.path) ?? 0) + 1);
  return map;
});
