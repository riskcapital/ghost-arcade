import { writable, get } from 'svelte/store';

export type GeoFormId = 'minimal' | 'hex' | 'grid' | 'sacred' | 'tunnel' | 'wave';
export type GeoActionId = 'pulse' | 'slice' | 'phase' | 'shatter' | 'tunnel' | 'hold';
export type GeoSliderKey = 'scale' | 'depth' | 'flow' | 'echo' | 'symmetry' | 'contrast';
export type GeoDeckTab = 'compose' | 'play' | 'mod';

export type GeoModSource = 'xyX' | 'xyY' | 'lfo1' | 'lfo2' | 'macro1' | 'macro2';
export type GeoModTarget = GeoSliderKey;

export interface GeoFormDef {
  id: GeoFormId;
  label: string;
  hint: string;
}

export interface GeoModRoute {
  id: string;
  source: GeoModSource;
  target: GeoModTarget;
  amount: number; // -1..1
  enabled: boolean;
}

export interface GeoScene {
  form: GeoFormId;
  params: Record<GeoSliderKey, number>;
  name: string;
}

export const GEO_FORMS: GeoFormDef[] = [
  { id: 'minimal', label: 'MINIMAL', hint: 'single-form focus' },
  { id: 'hex', label: 'HEX', hint: 'cell lattice' },
  { id: 'grid', label: 'GRID', hint: 'architectural space' },
  { id: 'sacred', label: 'SACRED', hint: 'ritual symmetry' },
  { id: 'tunnel', label: 'TUNNEL', hint: 'depth engine' },
  { id: 'wave', label: 'WAVE', hint: 'kinetic topography' },
];

export const GEO_FORM_KEYS: Record<string, GeoFormId> = {
  Digit1: 'minimal',
  Digit2: 'hex',
  Digit3: 'grid',
  Digit4: 'sacred',
  Digit5: 'tunnel',
  Digit6: 'wave',
};

export const GEO_ACTION_KEYS: Record<string, GeoActionId> = {
  KeyQ: 'pulse',
  KeyW: 'tunnel',
  KeyE: 'slice',
  KeyA: 'phase',
  KeyS: 'shatter',
  KeyD: 'hold',
};

export interface GeoDeckState {
  tab: GeoDeckTab;
  form: GeoFormId;
  action: GeoActionId;
  scale: number;
  depth: number;
  flow: number;
  echo: number;
  symmetry: number;
  contrast: number;
  macro1: number;
  macro2: number;
  sceneSlots: Array<GeoScene | null>;
  activeSceneSlot: number;
  morphTargetSlot: number | null;
  morph: number;
  modRoutes: GeoModRoute[];
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function clampSigned(v: number): number {
  return Math.max(-1, Math.min(1, v));
}

function sliderSnapshot(state: GeoDeckState): Record<GeoSliderKey, number> {
  return {
    scale: state.scale,
    depth: state.depth,
    flow: state.flow,
    echo: state.echo,
    symmetry: state.symmetry,
    contrast: state.contrast,
  };
}

function makeScene(name: string, form: GeoFormId, params: Record<GeoSliderKey, number>): GeoScene {
  return {
    name,
    form,
    params: {
      scale: params.scale,
      depth: params.depth,
      flow: params.flow,
      echo: params.echo,
      symmetry: params.symmetry,
      contrast: params.contrast,
    },
  };
}

function createGeoDeckStore() {
  const { subscribe, update, set } = writable<GeoDeckState>({
    tab: 'play',
    form: 'minimal',
    action: 'pulse',
    scale: 0.55,
    depth: 0.62,
    flow: 0.48,
    echo: 0.34,
    symmetry: 0.5,
    contrast: 0.7,
    macro1: 0.5,
    macro2: 0.5,
    sceneSlots: [
      makeScene('A', 'minimal', { scale: 0.52, depth: 0.58, flow: 0.42, echo: 0.4, symmetry: 0.35, contrast: 0.64 }),
      makeScene('B', 'grid', { scale: 0.66, depth: 0.78, flow: 0.54, echo: 0.22, symmetry: 0.72, contrast: 0.74 }),
      makeScene('C', 'sacred', { scale: 0.48, depth: 0.7, flow: 0.36, echo: 0.46, symmetry: 0.84, contrast: 0.68 }),
      makeScene('D', 'tunnel', { scale: 0.6, depth: 0.88, flow: 0.62, echo: 0.18, symmetry: 0.56, contrast: 0.82 }),
    ],
    activeSceneSlot: 0,
    morphTargetSlot: 1,
    morph: 0,
    modRoutes: [
      { id: 'r1', source: 'xyX', target: 'symmetry', amount: 0.45, enabled: true },
      { id: 'r2', source: 'xyY', target: 'depth', amount: -0.35, enabled: true },
      { id: 'r3', source: 'lfo1', target: 'flow', amount: 0.28, enabled: true },
      { id: 'r4', source: 'macro1', target: 'contrast', amount: 0.5, enabled: true },
      { id: 'r5', source: 'macro2', target: 'echo', amount: -0.5, enabled: false },
      { id: 'r6', source: 'lfo2', target: 'scale', amount: 0.22, enabled: false },
    ],
  });

  return {
    subscribe,
    setTab(tab: GeoDeckTab) {
      update((state) => ({ ...state, tab }));
    },
    setForm(form: GeoFormId) {
      update((state) => ({ ...state, form }));
    },
    setAction(action: GeoActionId) {
      update((state) => ({ ...state, action }));
    },
    setSlider(key: GeoSliderKey, value: number) {
      update((state) => ({ ...state, [key]: clamp01(value) }));
    },
    adjustSlider(key: GeoSliderKey, delta: number) {
      update((state) => ({ ...state, [key]: clamp01(state[key] + delta) }));
    },
    setMacro(which: 'macro1' | 'macro2', value: number) {
      update((state) => ({ ...state, [which]: clamp01(value) }));
    },
    cycleForm(direction: 1 | -1) {
      update((state) => {
        const idx = GEO_FORMS.findIndex((f) => f.id === state.form);
        const next = (idx + direction + GEO_FORMS.length) % GEO_FORMS.length;
        return { ...state, form: GEO_FORMS[next].id };
      });
    },
    randomize() {
      update((state) => {
        const form = GEO_FORMS[Math.floor(Math.random() * GEO_FORMS.length)].id;
        return {
          ...state,
          form,
          scale: Math.random(),
          depth: Math.random(),
          flow: Math.random(),
          echo: Math.random(),
          symmetry: Math.random(),
          contrast: Math.random(),
          macro1: Math.random(),
          macro2: Math.random(),
        };
      });
    },
    storeScene(slot: number) {
      update((state) => {
        if (slot < 0 || slot >= state.sceneSlots.length) return state;
        const sceneSlots = [...state.sceneSlots];
        const name = String.fromCharCode(65 + slot);
        sceneSlots[slot] = makeScene(name, state.form, sliderSnapshot(state));
        return { ...state, sceneSlots, activeSceneSlot: slot };
      });
    },
    recallScene(slot: number) {
      update((state) => {
        if (slot < 0 || slot >= state.sceneSlots.length) return state;
        const scene = state.sceneSlots[slot];
        if (!scene) return state;
        return {
          ...state,
          activeSceneSlot: slot,
          form: scene.form,
          scale: scene.params.scale,
          depth: scene.params.depth,
          flow: scene.params.flow,
          echo: scene.params.echo,
          symmetry: scene.params.symmetry,
          contrast: scene.params.contrast,
        };
      });
    },
    setMorphTarget(slot: number | null) {
      update((state) => ({ ...state, morphTargetSlot: slot }));
    },
    setMorph(value: number) {
      update((state) => ({ ...state, morph: clamp01(value) }));
    },
    setRouteEnabled(id: string, enabled: boolean) {
      update((state) => ({
        ...state,
        modRoutes: state.modRoutes.map((route) => route.id === id ? { ...route, enabled } : route),
      }));
    },
    setRouteAmount(id: string, amount: number) {
      update((state) => ({
        ...state,
        modRoutes: state.modRoutes.map((route) => route.id === id ? { ...route, amount: clampSigned(amount) } : route),
      }));
    },
    reset() {
      set({
        tab: 'play',
        form: 'minimal',
        action: 'pulse',
        scale: 0.55,
        depth: 0.62,
        flow: 0.48,
        echo: 0.34,
        symmetry: 0.5,
        contrast: 0.7,
        macro1: 0.5,
        macro2: 0.5,
        sceneSlots: [
          makeScene('A', 'minimal', { scale: 0.52, depth: 0.58, flow: 0.42, echo: 0.4, symmetry: 0.35, contrast: 0.64 }),
          makeScene('B', 'grid', { scale: 0.66, depth: 0.78, flow: 0.54, echo: 0.22, symmetry: 0.72, contrast: 0.74 }),
          makeScene('C', 'sacred', { scale: 0.48, depth: 0.7, flow: 0.36, echo: 0.46, symmetry: 0.84, contrast: 0.68 }),
          makeScene('D', 'tunnel', { scale: 0.6, depth: 0.88, flow: 0.62, echo: 0.18, symmetry: 0.56, contrast: 0.82 }),
        ],
        activeSceneSlot: 0,
        morphTargetSlot: 1,
        morph: 0,
        modRoutes: [
          { id: 'r1', source: 'xyX', target: 'symmetry', amount: 0.45, enabled: true },
          { id: 'r2', source: 'xyY', target: 'depth', amount: -0.35, enabled: true },
          { id: 'r3', source: 'lfo1', target: 'flow', amount: 0.28, enabled: true },
          { id: 'r4', source: 'macro1', target: 'contrast', amount: 0.5, enabled: true },
          { id: 'r5', source: 'macro2', target: 'echo', amount: -0.5, enabled: false },
          { id: 'r6', source: 'lfo2', target: 'scale', amount: 0.22, enabled: false },
        ],
      });
    },

    /** Whole-state snapshot for project save. The state is already serializable
     *  (no runtime refs), so we just return the current value. */
    serialize(): GeoDeckState {
      return get({ subscribe });
    },

    /** Restore from project save. Defensive merging — any field missing on
     *  a legacy save falls back to the current default value so old projects
     *  still open. */
    hydrate(payload: any) {
      if (!payload || typeof payload !== 'object') return;
      update((state) => ({
        ...state,
        ...payload,
        // Ensure arrays are not undefined / wrong shape (defensive against
        // older saves missing newer fields).
        sceneSlots: Array.isArray(payload.sceneSlots) ? payload.sceneSlots : state.sceneSlots,
        modRoutes: Array.isArray(payload.modRoutes) ? payload.modRoutes : state.modRoutes,
      }));
    },
  };
}

export const geoDeckStore = createGeoDeckStore();
