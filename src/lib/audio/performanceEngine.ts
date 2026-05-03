// Performance Engine
// Real-time visual instrument for live VJ performance
// Provides XY pad control, trigger buttons, momentum physics, and gesture tracking
// Maps physical gestures to shader parameters with smooth, expressive motion

import { writable, get } from 'svelte/store';
import { vjClipLauncher } from '../stores/vjClipLauncher';

// XY Pad state - maps to two shader parameters
export interface XYPadState {
  x: number;          // 0-1 normalized X position
  y: number;          // 0-1 normalized Y position
  velocityX: number;  // Momentum X
  velocityY: number;  // Momentum Y
  isPressed: boolean; // Currently touching/dragging
  trail: Array<{ x: number; y: number; age: number }>; // Gesture trail points
  // Parameter bindings
  paramX: string | null;  // ISF param name mapped to X axis
  paramY: string | null;  // ISF param name mapped to Y axis
  targetLayer: number;    // Which VJ layer this pad controls
}

// Trigger button - fires a visual event
export interface TriggerButton {
  id: string;
  label: string;
  color: string;
  // What happens when pressed
  action: TriggerAction;
  // State
  isPressed: boolean;
  intensity: number;  // 0-1, decays after release
  lastTriggerTime: number;
}

export type TriggerAction =
  | { type: 'param-flash'; layer: number; param: string; value: number; duration: number }
  | { type: 'effect-burst'; layer: number; effectType: string; intensity: number }
  | { type: 'strobe'; duration: number }
  | { type: 'freeze' }
  | { type: 'random-clip'; layer: number }
  | { type: 'color-shift'; amount: number };

export interface PerformanceState {
  isActive: boolean;
  xyPad: XYPadState;
  triggers: TriggerButton[];
  // Global performance settings
  momentum: number;     // 0-1 how much inertia gestures have
  beatSnap: boolean;    // Snap trigger actions to beats
  trailLength: number;  // Max trail points
}

function createDefaultState(): PerformanceState {
  return {
    isActive: false,
    xyPad: {
      x: 0.5,
      y: 0.5,
      velocityX: 0,
      velocityY: 0,
      isPressed: false,
      trail: [],
      paramX: null,
      paramY: null,
      targetLayer: 0,
    },
    triggers: [
      {
        id: 'flash',
        label: 'FLASH',
        color: '#fff',
        action: { type: 'strobe', duration: 100 },
        isPressed: false,
        intensity: 0,
        lastTriggerTime: 0,
      },
      {
        id: 'glitch',
        label: 'GLITCH',
        color: '#f43f5e',
        action: { type: 'effect-burst', layer: 0, effectType: 'glitch', intensity: 0.8 },
        isPressed: false,
        intensity: 0,
        lastTriggerTime: 0,
      },
      {
        id: 'color',
        label: 'COLOR',
        color: '#a855f7',
        action: { type: 'color-shift', amount: 0.3 },
        isPressed: false,
        intensity: 0,
        lastTriggerTime: 0,
      },
      {
        id: 'freeze',
        label: 'FREEZE',
        color: '#67E8F9',
        action: { type: 'freeze' },
        isPressed: false,
        intensity: 0,
        lastTriggerTime: 0,
      },
      {
        id: 'drop',
        label: 'DROP',
        color: '#22c55e',
        action: { type: 'param-flash', layer: 0, param: 'speed', value: 5.0, duration: 500 },
        isPressed: false,
        intensity: 0,
        lastTriggerTime: 0,
      },
      {
        id: 'random',
        label: 'RANDOM',
        color: '#eab308',
        action: { type: 'random-clip', layer: 0 },
        isPressed: false,
        intensity: 0,
        lastTriggerTime: 0,
      },
    ],
    momentum: 0.85,
    beatSnap: false,
    trailLength: 30,
  };
}

function createPerformanceStore() {
  const { subscribe, update } = writable<PerformanceState>(createDefaultState());

  let animFrameId: number | null = null;
  let isRunning = false;
  let strobeActive = false;
  let strobeEnd = 0;
  let frozenParams: Map<string, Record<string, any>> = new Map();

  function tick() {
    if (!isRunning) return;

    update(state => {
      const now = performance.now();

      // Idle fast path: when nothing is happening (pad released + still, no
      // trail, all triggers faded out, no strobe), skip the full clone+map
      // work and just return the same state reference. This prevents Svelte
      // from re-notifying subscribers at 60 Hz when the user isn't interacting.
      const padIdle = !state.xyPad.isPressed
        && state.xyPad.velocityX === 0
        && state.xyPad.velocityY === 0
        && state.xyPad.trail.length === 0;
      const triggersIdle = !state.triggers.some(t => t.intensity > 0.001);
      if (padIdle && triggersIdle && !strobeActive) {
        return state;
      }

      // === XY Pad Physics ===
      const pad = { ...state.xyPad };

      if (!pad.isPressed) {
        // Apply momentum (damped)
        pad.x += pad.velocityX;
        pad.y += pad.velocityY;
        pad.velocityX *= state.momentum;
        pad.velocityY *= state.momentum;

        // Clamp
        pad.x = Math.max(0, Math.min(1, pad.x));
        pad.y = Math.max(0, Math.min(1, pad.y));

        // Stop tiny movements
        if (Math.abs(pad.velocityX) < 0.0005) pad.velocityX = 0;
        if (Math.abs(pad.velocityY) < 0.0005) pad.velocityY = 0;
      }

      // Age trail points and remove old ones (skip allocation when empty)
      if (pad.trail.length > 0) {
        pad.trail = pad.trail
          .map(p => ({ ...p, age: p.age + 1 }))
          .filter(p => p.age < state.trailLength);
      }

      // Apply XY pad to shader params
      const vjNumLayers = get(vjClipLauncher).numLayers;
      if (pad.paramX && pad.targetLayer >= 0 && pad.targetLayer < vjNumLayers) {
        vjClipLauncher.updateActiveClipShaderValue(pad.targetLayer, pad.paramX, pad.x);
      }
      if (pad.paramY && pad.targetLayer >= 0 && pad.targetLayer < vjNumLayers) {
        vjClipLauncher.updateActiveClipShaderValue(pad.targetLayer, pad.paramY, pad.y);
      }

      // === Trigger decay ===
      // Skip allocation when all triggers are already cold (pairs with the
      // idle-fast-path above; this is the next-best case when only the pad
      // is active but triggers are at rest).
      const triggers = triggersIdle
        ? state.triggers
        : state.triggers.map(t => ({
            ...t,
            intensity: t.intensity * 0.92,  // Decay
          }));

      // === Strobe effect ===
      if (strobeActive && now > strobeEnd) {
        strobeActive = false;
        // Restore opacity
        const vjState = get(vjClipLauncher);
        for (let i = 0; i < vjState.layerStates.length; i++) {
          vjClipLauncher.setLayerOpacity(i, 1);
        }
      } else if (strobeActive) {
        // Rapid flash
        const flash = Math.sin(now * 0.06) > 0;
        const vjState = get(vjClipLauncher);
        for (let i = 0; i < vjState.layerStates.length; i++) {
          if (vjState.layerStates[i].activeClip) {
            vjClipLauncher.setLayerOpacity(i, flash ? 1 : 0.05);
          }
        }
      }

      return { ...state, xyPad: pad, triggers };
    });

    animFrameId = requestAnimationFrame(tick);
  }

  return {
    subscribe,

    start() {
      update(s => ({ ...s, isActive: true }));
      if (!isRunning) {
        isRunning = true;
        tick();
      }
    },

    stop() {
      isRunning = false;
      if (animFrameId !== null) {
        cancelAnimationFrame(animFrameId);
        animFrameId = null;
      }
      strobeActive = false;
      frozenParams.clear();
      update(s => ({ ...s, isActive: false }));
    },

    // XY Pad controls
    padPress(x: number, y: number) {
      update(s => ({
        ...s,
        xyPad: {
          ...s.xyPad,
          x, y,
          isPressed: true,
          velocityX: 0,
          velocityY: 0,
          trail: [...s.xyPad.trail, { x, y, age: 0 }],
        },
      }));
    },

    padMove(x: number, y: number) {
      update(s => {
        if (!s.xyPad.isPressed) return s;
        const dx = x - s.xyPad.x;
        const dy = y - s.xyPad.y;
        return {
          ...s,
          xyPad: {
            ...s.xyPad,
            x, y,
            velocityX: dx * 0.5,
            velocityY: dy * 0.5,
            trail: [...s.xyPad.trail, { x, y, age: 0 }],
          },
        };
      });
    },

    padRelease() {
      update(s => ({
        ...s,
        xyPad: { ...s.xyPad, isPressed: false },
      }));
    },

    // Bind XY pad axes to shader params
    bindPadParam(axis: 'x' | 'y', paramName: string | null) {
      update(s => ({
        ...s,
        xyPad: {
          ...s.xyPad,
          [axis === 'x' ? 'paramX' : 'paramY']: paramName,
        },
      }));
    },

    setPadTargetLayer(layer: number) {
      update(s => ({
        ...s,
        xyPad: { ...s.xyPad, targetLayer: layer },
      }));
    },

    // Trigger buttons
    fireTrigger(triggerId: string) {
      const now = performance.now();

      update(s => {
        const triggers = s.triggers.map(t => {
          if (t.id !== triggerId) return t;
          return { ...t, isPressed: true, intensity: 1, lastTriggerTime: now };
        });
        return { ...s, triggers };
      });

      // Execute action
      const state = get({ subscribe });
      const trigger = state.triggers.find(t => t.id === triggerId);
      if (!trigger) return;

      this.executeTriggerAction(trigger.action);
    },

    releaseTrigger(triggerId: string) {
      update(s => ({
        ...s,
        triggers: s.triggers.map(t =>
          t.id === triggerId ? { ...t, isPressed: false } : t
        ),
      }));
    },

    executeTriggerAction(action: TriggerAction) {
      const now = performance.now();

      switch (action.type) {
        case 'strobe':
          strobeActive = true;
          strobeEnd = now + action.duration;
          break;

        case 'param-flash': {
          // Briefly set a param to a high value, then let it decay
          const prevVal = get(vjClipLauncher).layerStates[action.layer]?.activeClip?.shaderValues?.[action.param];
          vjClipLauncher.updateActiveClipShaderValue(action.layer, action.param, action.value);
          // Restore after duration
          setTimeout(() => {
            if (prevVal !== undefined) {
              vjClipLauncher.updateActiveClipShaderValue(action.layer, action.param, prevVal);
            }
          }, action.duration);
          break;
        }

        case 'effect-burst': {
          // Add a temporary effect at high intensity
          const effectId = `perf-${Date.now()}`;
          vjClipLauncher.addLayerEffect(action.layer, {
            id: effectId,
            type: action.effectType as any,
            enabled: true,
            params: { amount: action.intensity, intensity: action.intensity },
          });
          // Remove after 500ms
          setTimeout(() => {
            vjClipLauncher.removeLayerEffect(action.layer, effectId);
          }, 500);
          break;
        }

        case 'freeze': {
          // Toggle freeze - store/restore TIME param
          const vjState = get(vjClipLauncher);
          for (let i = 0; i < vjState.layerStates.length; i++) {
            const clip = vjState.layerStates[i].activeClip;
            if (clip?.shaderValues) {
              const currentSpeed = clip.shaderValues['speed'] ?? clip.shaderValues['Speed'] ?? 1;
              vjClipLauncher.updateActiveClipShaderValue(i, 'speed', currentSpeed > 0.01 ? 0 : 1);
            }
          }
          break;
        }

        case 'color-shift': {
          // Shift hue-like params on all active layers
          const vjState2 = get(vjClipLauncher);
          for (let i = 0; i < vjState2.layerStates.length; i++) {
            const clip = vjState2.layerStates[i].activeClip;
            if (clip?.shaderValues) {
              for (const key of Object.keys(clip.shaderValues)) {
                const lk = key.toLowerCase();
                if (lk.includes('hue') || lk.includes('color') || lk.includes('tint')) {
                  const current = clip.shaderValues[key];
                  if (typeof current === 'number') {
                    vjClipLauncher.updateActiveClipShaderValue(i, key, (current + action.amount) % 1);
                  }
                }
              }
            }
          }
          break;
        }

        case 'random-clip': {
          // Trigger a random clip on the specified layer
          const vjState3 = get(vjClipLauncher);
          const grid = vjState3.clipGrid;
          const layer = action.layer;
          const available: number[] = [];
          for (let col = 0; col < grid[layer].length; col++) {
            if (grid[layer][col]) available.push(col);
          }
          if (available.length > 0) {
            const col = available[Math.floor(Math.random() * available.length)];
            vjClipLauncher.triggerClip(layer, col);
          }
          break;
        }
      }
    },

    // Settings
    setMomentum(value: number) {
      update(s => ({ ...s, momentum: Math.max(0, Math.min(0.99, value)) }));
    },

    setBeatSnap(enabled: boolean) {
      update(s => ({ ...s, beatSnap: enabled }));
    },
  };
}

export const performanceStore = createPerformanceStore();
