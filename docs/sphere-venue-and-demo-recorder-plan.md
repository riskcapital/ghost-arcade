# Plan: Sphere Venue + Demo Recorder (Sizzle Reel)

Two features that compound: a Las-Vegas-Sphere-style immersive dome
venue for Stage 3D ("dream big"), and a shot-based **Demo Recorder**
that turns any stage design — sphere or standard venues — into a
high-res, professionally-shot MP4 sizzle reel for client proposals.

Status: PLANNED (no code yet). Written 2026-06-12 while Syphon Phase 3
work happens on the Mac — nothing here touches `electron/native` or the
texture-share pipeline, so the two streams can't collide.

---

## Part A — Sphere venue

### Why it's feasible now
- `StageLedScreenNode` already has a `curvature` field and
  `LedScreen3D.svelte` builds procedural curved geometry from it
  (1D cylindrical bend along width, `LedScreen3D.svelte:84-107`).
- Screens sample the master composite as a shared GPU texture with
  per-screen crop UVs + displayFit shader — a dome only needs its own
  UV mapping, the texture path is untouched.
- Venues are procedural presets (`venues.ts buildVenue()` →
  festival/arena/club/nightclub) with tagged, individually editable
  scenery pieces (`sceneryOverrides`, commit `8edf6e3`), per-venue
  cameras, lighting, fog. A fifth venue slots straight in.
- LED-glow-as-area-light already exists (`deab472`) — the Sphere's
  defining trait (the screen IS the lighting rig) is already our trait.

### A1. Dome screen geometry
New geometry builder (lives next to the arc builder in
`LedScreen3D.svelte` or a `domeGeometry.ts` helper):

- **Spherical cap section**, lat/long grid (~96 × 48 segments, built
  once — static unless params change), normals facing INWARD.
- Params (all optional new fields on `StageLedScreenNode`, fully
  backward compatible):
  - `geometryType?: 'flat' | 'curved' | 'dome'` (absent → existing
    flat/curvature behavior, untouched)
  - `domeRadius` (meters)
  - `domeHSweepDeg` (horizontal arc, e.g. 90–270; Sphere ≈ 220–240
    as seen from the bowl)
  - `domeVStartDeg` / `domeVEndDeg` (vertical arc: from below the
    horizon at stage level up past the zenith behind the audience)
  - `domeTiltDeg` (lean the whole cap toward the audience)
- **UVs**: lat/long → (u,v) — effectively a mini-equirect, which is
  how the real Sphere authors content. MUST respect the unified
  canvas-Y-down crop convention from `14427ed` (the dome gets its own
  UV path; the rectangular corner-pin math is NOT reused).
- Existing `crop` region + `displayFit` keep working: the crop selects
  what part of the master feeds the dome; fit modes decide how it
  stretches across the cap.

### A2. "Sphere" venue preset (`buildSphere()` in venues.ts)
As close to the real venue as our procedural style allows:

- **Proportions** (scaled): real interior ≈ 157 m wide × 112 m tall,
  screen ≈ 76 m tall sweeping behind/above the stage and over the
  bowl. Use venue units ≈ meters: dome radius ~55–60, screen vertical
  sweep from ≈ −5° (just below stage horizon) to ≈ +110° (past zenith,
  ending behind/above the back rows).
- **Seating bowl**: steeply raked amphitheater — procedural ring
  segments (BoxGeometry rows on a rising curve), one-directional
  (everyone faces the stage, like the real bowl — NOT 360°), broken
  into 3–4 tiers with aisles. Each tier/section tagged with
  `userData.sceneryId` (`bowl-tier-0`, `bowl-aisle-L`, …) so users get
  the same select/hide/move/reset treatment as the festival's 49
  pieces.
- **Stage**: low, wide platform island at the dome's base — modest by
  design, the screen is the scenery. Optional thrust/turntable piece
  (U2-style) as a hideable scenery item.
- **Deliberately absent**: trusses, PA stacks, movers, side screens.
  The real venue hides audio behind the screen; everything scenic is
  pixels. (Users can still add library objects manually.)
- **Atmosphere**: dark neutral shell behind/around the dome edge, haze
  enabled, floor reflection subtle.
- **Auto-built LED**: generalize `VenueBuild.ledWall` (mount region) so
  a venue can declare a **ledDome** instead — when the sphere venue is
  selected, the auto-created screen comes in as `geometryType:'dome'`
  with venue-tuned sweep/radius. Other venues unchanged.

### A3. Lighting & look
- Dome glow = dominant room light: reuse the existing async LED color
  readback to drive a large soft hemisphere/area light pair (bowl fill
  + stage fill). Falls back to static warm fill when readback is off.
- Bloom tuned per-venue (like festival's bloomStrength override) so the
  dome reads emissive without washing out; shadows OFF inside the dome
  (no hard sources; saves the 2048 shadow map).
- Camera presets in `VenueBuild`:
  - **Audience seat** (mid-bowl, wide FOV ~75–85°) — the "whoa" shot
  - **FOH / center bowl**
  - **Stage looking back** (performer POV — dome towering over bowl)
  - **Orbit/frame-all** (existing behaviors)

### A4. Content mapping modes (phased)
1. `wrap` (ship first): master crop spreads across the full cap
   (equirect-style). Honest caveat: flat 16:9 content distorts near
   the zenith — inherent to wrapping a rectangle on a sphere; the real
   venue has the same constraint. `contain`/`cover` letterbox onto the
   central band instead.
2. Later (stretch): `domemaster` fisheye input mode for users who
   author real dome content; and a "band + cap" split (content band at
   eye level, generated ambience above).

### A5. Out of scope (explicitly)
- No physical-Sphere output format (16K equirect export). Slices
  already send arbitrary crops via Spout/Syphon/NDI to media servers —
  good enough for real-venue handoff.
- No 360° seating, no haptics modeling, no acoustic sim.

---

## Part B — Demo Recorder (shot-based sizzle reel)

Works for ALL venues (sphere + standard stages). Goal: user sets stage
visuals → saves Shot 1 → changes visuals/camera → saves Shot 2 → drags
shots into a sequence with per-shot durations → renders a high-res MP4
offline (non-realtime), pro-camera-move quality, for proposals.

### What we already have (load-bearing!)
- **Offline renderer** (`src/lib/recording/offlineRender.ts` +
  `OfflineRenderModal.svelte`): FFmpeg.wasm, deterministic
  frame-stepping (`virtualTime = frame/fps`), manual-time overrides for
  shaders/keyframes/sequencer, JPEG intermediates → libx264 MP4, up to
  4K @ 24/30/60, CRF quality tiers. Proven.
- **Keyframeable camera** in Stage 3D: FOV, Distance, OrbitX/Y,
  PanX/Y, Roll tracks with named easings, all evaluated via
  `keyframeTimeline.seek(virtualTime)` — already driven per-frame by
  the offline renderer.
- **State snapshots**: stage3d store has undo `snapshot()` machinery +
  `stagePresets` exist in the project store; screens/scenery/lighting
  state is one serializable object.

### B1. Data model
```ts
interface DemoShot {
  id: string;
  name: string;            // "Shot 1"
  thumbnail?: string;      // small JPEG captured at save time
  durationSec: number;     // user-editable per shot
  easing: EasingName;      // applied to the camera move
  move: {
    templateId: string;    // 'push-in' | 'slow-pan-lr' | 'orbit-cw' |
                           // 'crane-up' | 'audience-sweep' |
                           // 'dome-lookup-reveal' | 'static' | 'custom'
    // start/end camera states (FOV, distance, orbit, pan, roll) —
    // captured from the live camera at save time, or template-derived
    from: StageCameraState;
    to: StageCameraState;
  };
  visuals: {
    stage3d: Stage3DSceneSnapshot;   // lighting/screens/scenery state
    contentRef: string | null;       // stage preset / composition id —
                                     // what the screens are playing
  };
}

interface DemoSequence {
  id: string; name: string;
  shotIds: string[];        // ordered
  transition: 'cut';        // v1: hard cuts only (crossfade later)
  fps: 24 | 30 | 60;
  width: number; height: number;   // up to 4K
}
```
Persisted in the project (exportable with it).

### B2. Shot tray UI (in the Stage 3D window)
- **Left tray: move templates** — drag-and-drop cards with icons:
  Push-in from floor, Slow pan L→R / R→L, Orbit 30°, Crane up,
  Audience-seat sweep, Dome look-up reveal (sphere venue), FOH static,
  Custom (uses your current camera as both ends, or A→B grab).
- **"Save Shot" button**: snapshots current camera + stage3d state +
  active content into a new shot card (with thumbnail), lands in the
  user's shot bin.
- **Bottom strip: the sequence** — drag shots from tray/bin into an
  ordered strip; reorder; click a shot to edit duration/easing/move;
  running total duration displayed.
- **Preview**: realtime approximate playback in the viewport (best
  effort — videos may hitch; that's fine, the render is offline).

### B3. Sequence playback engine (`shotSequencer`)
Mirror of `layerSequencer`: `shotSequencer.seek(virtualTime)` →
1. Find active shot by accumulated durations.
2. On shot ENTRY (boundary crossing): apply the shot's
   `visuals.stage3d` snapshot + activate `contentRef` (deterministic —
   same frame every render).
3. Within the shot: interpolate `move.from → move.to` with the easing
   and write the camera (same camera-state path the keyframe tracks
   use).

### B4. Offline render integration (the only deep work)
The current offline renderer reads the ENGINE composite (2D master).
The sizzle reel needs the **Stage 3D viewport** rendered offline:

- Parameterize the offline pipeline's frame source: keep the existing
  frame loop + FFmpeg encode, add a `stage3d` source that
  - sizes the Stage3DRenderer to the render W×H offscreen
    (independent of window size),
  - per frame: `shotSequencer.seek(t)` (camera + visuals) AND the
    existing engine manual-time seeks (so the LED CONTENT animates
    deterministically too — shaders, keyframes, sequencer),
  - renders one Stage3D frame, reads pixels (Stage3DRenderer render
    target; same preserveDrawingBuffer caveat as the engine — read
    from the target, not the canvas), JPEG → FFmpeg.
- Reuse OfflineRenderModal patterns for progress (loading-ffmpeg →
  rendering → encoding → saving), launched from a **Render Reel**
  button on the sequence strip.
- Known constraint inherited from the existing renderer: video-file
  layers seek best-effort. Shader/generative content is
  frame-perfect; heavy video content may need the existing caveats
  documented in the recorder UI.

### B5. Polish (later)
- Crossfade transitions (render both shots at boundary frames, blend).
- Music bed: mux a user-chosen audio file in the FFmpeg step
  (trivial — `-i audio -shortest`).
- Title card / logo overlay shot type.
- Export/import shot sequences between projects.

---

## Phasing & order of attack

| Phase | What | Depends on |
|-------|------|-----------|
| S1 | Dome geometry + schema (`geometryType:'dome'`) | — |
| S2 | Sphere venue preset (bowl, stage, ledDome, cameras, lighting) | S1 |
| R1 | Shot data model + Save Shot + tray/sequence UI + realtime preview | — (parallel with S1/S2) |
| R2 | `shotSequencer` + offline Stage3D frame source + Render Reel | R1 |
| S3/R3 | Content mapping modes; crossfades, music bed, title cards | S2, R2 |

S-track and R-track are independent until the demo: the sphere venue
is the hero content FOR the sizzle reel, but the recorder works on the
existing four venues from day one.

Suggested first session: S1 + S2 in one sitting (geometry builder is
the only risk; the venue preset is established-pattern work), verify
visually, then start R1.
