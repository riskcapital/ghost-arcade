# Ghost Pilot — Multi-World Vision & Handoff

> Living design doc + dev handoff for the **Ghost Pilot** generator. Written
> to move the session from Windows → Mac and keep building. Last touched on
> the Neon Canyon world (world #1) — see **Current State** before you start.

---

## 1. What Ghost Pilot is

A **playable, audio-built world you fly with a gamepad** (or keyboard), rendered
as a drop-in Ghost Arcade layer source. It is *not* a screensaver: the music
**builds the world**, the performer **navigates and sculpts** it.

It renders a fullscreen raymarch into the layer's `WebGLRenderTarget`, so it
inherits everything for free: VJ mixing, post effects, every output transport,
Stage 3D LED screens, and the Sphere dome.

### The three design laws (do not break these)

1. **Audio BUILDS the world; you navigate it.** Terrain/structure is driven by
   bass/mid/treble/energy. The player only moves the camera. Manual control and
   reactivity never fight because they act on *different things* (music =
   geography, you = camera).
2. **Every input is MUSICAL.** Sticks get physics (inertia, banking, damping) so
   even sloppy input reads like cinematography. Buttons are **beat-quantized
   verbs** that fire on the next beat — a verb slammed near the drop lands *on*
   the drop.
3. **Idle is BEAUTIFUL.** Let go and autopilot banks the craft down the world on
   its own. The performer sculpts; they don't life-support.

---

## 2. Current State (as of this handoff)

**World #1 — Neon Canyon** is built and playable. Beyond the committed `v1`,
this handoff carries a large second pass (now committed alongside this doc):

- Retrowave **sun** + flowing **aurora** curtains + starfield sky.
- Audio-spawned **neon gates** rushing the camera (flare on beat, densify in
  tunnels).
- **Hyperspace streaks** streaming from the vanishing point (ride speed/energy).
- **Spacebar shockwave** — a distinct blend (photo-negative + screen + hot core)
  with an FOV punch.
- **Psychedelic ray-warp** + full-RGB hue shimmer + cinematic vignette.
- Multi-scale **wireframe terrain** with evolving/morphing ridges and breathing
  **tunnel sections** (wide valley ⇄ tight wild tunnel).
- **Keyboard fallback** so it's fully playable with no controller.

### Files

| File | Role |
|---|---|
| `src/lib/effects/ghostPilot/ghostPilotVisualizer.ts` | **The engine.** Camera physics, audio smoothing, verb scheduler, autopilot, uniform writer. World-agnostic — this is the part that gets reused across worlds. |
| `src/lib/effects/ghostPilot/canyonShader.ts` | **World #1 shader.** `CANYON_VERT` + `CANYON_FRAG`. Pure GLSL fed by the engine's uniforms. |
| `src/lib/input/gamepad.ts` | Shared input. Gamepad poll + `setKeyboardPilotActive()` keyboard pilot fallback. |
| `src/lib/plugins/registry.ts` | Plugin registration (`id: 'ghostpilot'`, `effectType: 'ghostpilot'`, param defs). |
| `scripts/_ghostpilot_verify.js` | CDP boot/verify helper — drops the pilot into a layer and arms input. |

### The uniform contract (engine → shader)

The engine writes these every frame; any world shader consumes the subset it
needs. **This contract is the seam the multi-world architecture pivots on.**

```
uResolution, uTime
uCamPos, uCamFwd, uCamRight, uCamUp, uTanHalfFov   // camera basis (JS physics)
uBass, uMid, uTreble, uEnergy, uLevel              // smoothed audio
uHue                                               // palette rotation 0..1
uFlip, uBloom, uPulseZ, uPulseStr                  // verbs
uBeat, uShock, uSpeed, uStreaks                    // beat flash / shockwave / speed / toggle
```

### Controls (gamepad / keyboard)

| Action | Gamepad | Keyboard |
|---|---|---|
| Steer | Left stick X | A / D · ← / → |
| Throttle / Brake | RT / LT | W / ↑ · S / ↓ |
| Look (yaw/pitch) | Right stick | Q / E (yaw) |
| Pulse (shockwave) | A | Space |
| Bloom | X | B |
| Flip world | B | F |
| Dive | Y | V |
| Toggle streaks | RB | T |

Verbs are **beat-quantized**: queued on press, fired on the next beat onset
(fallback ~half-beat so it never feels stuck on quiet passages). `flip`/`dive`
cost energy; insufficient charge fizzles to a small bloom so the press still
reads.

---

## 3. The Multi-World Vision

Ghost Pilot becomes a **roster of flyable worlds** sharing one engine. The
performer (or the show director) switches worlds like switching tracks — each
world is a different *place* with the same flight feel, the same musical verbs,
and the same "audio builds it, you fly it" contract.

### Why this works architecturally

The expensive, hard-won part — camera physics, asymmetric audio smoothing,
beat-quantized verb scheduling, autopilot, the uniform writer — is **already
world-agnostic** and lives in `ghostPilotVisualizer.ts`. A "world" is mostly:

- a **fragment shader** that reads the uniform contract, and
- a small **world descriptor** (name, palette defaults, which verbs it supports,
  optional per-world tuning of speed/altitude/centering).

So multi-world is a **refactor + content** play, not a rewrite.

### Target architecture

```
ghostPilot/
  engine/
    pilotEngine.ts        // ← today's ghostPilotVisualizer.ts, world-agnostic
    cameraPhysics.ts      // (optional) extracted physics
    verbs.ts              // verb kinds, costs, scheduler
  worlds/
    world.ts              // World interface (the contract, below)
    canyon.ts             // world #1 — today's canyonShader.ts wrapped
    <world2>.ts
    <world3>.ts
    index.ts              // WORLDS registry + getWorld(id)
  ghostPilotVisualizer.ts // thin: owns engine + active World, swaps shaders
```

### The `World` contract (implement this on Mac)

```ts
export interface World {
  id: string;                 // 'canyon', 'reef', 'lattice', ...
  name: string;               // 'Neon Canyon'
  fragmentShader: string;     // reads the uniform contract
  vertexShader?: string;      // defaults to the shared fullscreen-quad vert
  palette?: { hueBase: number };
  // Per-world physics overrides (engine clamps + defaults if omitted):
  tuning?: Partial<{
    cruiseSpeed: number;      // base forward speed
    baseAltitude: number;     // cruise height
    centeringSpring: number;  // how hard you're pulled to the navigable center
    navHalfWidth: number;     // |posX| clamp (canyon walls vs open space)
    fovDeg: number;
  }>;
  // Which verbs this world implements (so the HUD can hide unsupported ones):
  verbs?: VerbKind[];
  // Optional: extra uniforms unique to this world + their per-frame writer.
  extraUniforms?: () => Record<string, THREE.IUniform>;
  writeExtra?: (u: Record<string, THREE.IUniform>, ctx: WorldFrameCtx) => void;
}
```

`WorldFrameCtx` = the engine's per-frame state (smoothed audio, camera, verb
envelopes, timeSec) so a world can drive bespoke uniforms without the engine
knowing what they mean.

### World switching

- **Verb or param:** add a `World` param to the plugin (dropdown) + a "next
  world" verb (e.g. a shoulder-button chord) that **cross-fades on the beat**.
- **Swap = rebuild the `ShaderMaterial`** with the new world's shaders + merged
  uniforms; keep the camera state continuous so flight doesn't jump.
- **Transition:** reuse the shockwave/flip envelopes as a "warp jump" between
  worlds so the switch is itself a musical moment.

### World roster (ideas — build the seam first, then fill)

| World | Place | Audio→geometry mapping | Signature verb |
|---|---|---|---|
| **Neon Canyon** *(done)* | Retrowave valley + tunnels | bass → wall height/ridge amp; tunnelness breathes | pulse shockwave |
| **Crystal Lattice** | Infinite voxel/SDF lattice | mid → cell subdivision; treble → edge glow | "shatter" (fracture the lattice on beat) |
| **Deep Reef** | Bioluminescent underwater trench | bass → current/sway; level → plankton bloom | "current surge" (rip the camera forward) |
| **Cloud Cathedral** | Volumetric cloud nave, godrays | energy → cloud density; treble → light shafts | "rapture" (part the clouds, sun flare) |
| **Circuit City** | Tron-grid megastructure flythrough | bass → building height; beat → window lights | "overclock" (speed + chromatic split) |
| **Solar Wind** | Open space, ribbons + a near star | energy → solar flare; bass → ribbon turbulence | "flare ride" |
| **Inkwell** | Monochrome fluid/ink sim, negative space | level → ink injection; treble → fine eddies | "spill" (invert + bloom) |

Keep verbs **mapped to the same buttons** across worlds (A=signature pulse,
B=flip, X=bloom, Y=dive) so muscle memory transfers; only the *visual* changes.

---

## 4. Roadmap (suggested order for the Mac session)

1. **Extract the seam.** Rename `ghostPilotVisualizer.ts`'s shader-specific bits
   behind the `World` interface. Wrap the canyon as `worlds/canyon.ts`. The
   visualizer holds an `activeWorld` and rebuilds the material from it. *No
   visual change — this is the de-risking refactor.* Verify canyon still flies.
2. **Add a second world** (suggest **Crystal Lattice** — pure SDF, cheap, very
   different look) to prove the contract generalizes. Resist adding bespoke
   uniforms until the shared contract can't express it.
3. **World switching** — plugin `World` dropdown + beat-quantized warp-jump
   transition reusing the shock/flip envelopes. Keep camera continuous.
4. **Per-world tuning** — wire `tuning` overrides into the physics so e.g. the
   reef feels heavy/slow and circuit city feels fast/tight.
5. **HUD overlay** (`window.__ghostPilot` already exposes the instance and
   `getTelemetry()`): world name, energy charge, active verb, speed. The debug
   hook and telemetry are already there for this.
6. **Show-director integration** — let the v1.9.2 show director pick/auto-rotate
   worlds to the set's energy arc.
7. Fill out the roster.

### Guardrails learned on world #1 (carry forward)

- **Fixed altitude, not terrain-following.** Avoid JS/GLSL height-parity
  headaches; let walls tower around a steady cruise height.
- **Centering spring + hard nav clamp** keep the craft out of walls in idle/
  autopilot. Every enclosed world needs an equivalent "don't bury the camera"
  spring.
- **Asymmetric audio smoothing** (fast attack, slow release): "anticipate, don't
  twitch." Reuse for every world.
- Keep raymarch loops bounded and step-size adaptive; world shaders must stay
  cheap enough to also feed Stage 3D LED screens + the Sphere dome.

---

## 5. Dev / boot on Mac

```bash
git pull                 # this doc + the canyon second-pass land together
npm install
npm run dev              # Vite dev server
```

Drop the pilot into a layer + arm input via CDP (mirrors
`scripts/_ghostpilot_verify.js`):

- Import `src/lib/stores/layers.ts`, `src/lib/plugins/registry.ts`,
  `src/lib/input/gamepad.ts`.
- `project.setLayerSource(layerId, { type:'effect', src:'plugin://ghostpilot',
  effectSource:{ effectType:'ghostpilot', ...defaultSourceParams } })`.
- `gamepad.startGamepadPolling(); gamepad.setKeyboardPilotActive(true);`
- Probe live state via `window.__ghostPilot.getTelemetry()`.

> CDP gotchas (from prior sessions): `replMode` breaks `awaitPromise`; OneDrive
> can make Vite serve stale code (fetch-verify before concluding). On Mac (no
> OneDrive) the stale-code issue should disappear. The recover-modal / 0-layers
> gotcha: ensure a layer exists before setting its source.

---

## 6. Open questions to decide on Mac

- **World switching UX:** dropdown only, or a live "jump" verb during a set?
- **Per-world verbs vs universal verbs:** keep 4 universal buttons (recommended)
  or allow worlds to redefine them?
- **Transition style:** hard warp-cut on beat, or a cross-dissolve between two
  live-rendered worlds (2× shader cost for the transition window)?
- **Authoring:** are worlds always hand-written GLSL, or do we want a small DSL
  / Hydra-style live-code path so worlds can be made without rebuilding?
