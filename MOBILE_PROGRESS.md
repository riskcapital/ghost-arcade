# Ghost Arcade Mobile — Progress & Resume Notes

**Status:** Code complete on both platforms. Submission pending external accounts. Updated 2026-06-03.

---

## Locked-in product decisions

| Decision | Value |
|---|---|
| App name | Ghost Arcade |
| Bundle ID | `com.ghostarcade.mobile` |
| Pricing | Free forever, all features unlocked, no accounts, no backend |
| Framework | Capacitor 8.4.0 (wraps Svelte/Vite, single codebase with desktop) |
| Scope | Standalone-first VJ + projection-mapping tool; remote-control to desktop is secondary |
| Projector output | USB-C → HDMI screen mirroring + "Clean Output" mode (long-press hides UI) |
| Shader behavior | All shaders audio-reactive at GLSL level (native or auto-injected) |

### Hard NOs
- No AI generation
- No point clouds / gaussian splats / 3D models
- No raymarched 3D / fluid sim / heavy multi-pass shaders
- No accounts / backend / server-side anything

---

## What ships in v1

### Standalone mode (the headline feature)
- **30 curated shaders** — 20 ship-as-is (natively audio-reactive) + 10 augment (universal audio patch auto-injected on load)
- **A/B deck system** — two WebGL canvases stacked, B with adjustable opacity for crossfade
- **9-slot clip launcher** — bottom sheet with category-coded clip pads, tap to launch, long-press to clear
- **Crossfader** — horizontal slider at bottom with A / B snap buttons. Tap a clip and it routes into the deck the crossfader points away from (Resolume style).
- **8 blend modes** — normal / screen / multiply / overlay / difference / lighten / darken / color-dodge. CSS mix-blend-mode on deck B.
- **Shader picker** — bottom-sheet grid with category filter (All / Audio / Rooms / Fluid / Pattern / Kinetic). Tap an empty slot to assign.
- **Touch projection mapping** — 4-corner perspective warp with finger-drag handles. Computes proper homography via 8x8 linear solve, applied as `transform: matrix3d(...)` to the canvas wrapper. Reset button included.
- **Mic-driven audio reactivity** — Web Audio analyser publishes `audioBass / audioMid / audioHigh / audioLevel / audioBeat` (matched to desktop's uniform set). Beat detection via envelope follower on the bass band.
- **Clean Output mode** — long-press anywhere hides every UI overlay so USB-C → HDMI screen mirroring shows pure visuals. Tap to bring UI back.
- **Auto-save** — every state change persists to localStorage. Pads, crossfader position, blend mode, projection map corners all survive relaunch.
- **First-run onboarding** — welcome card with 4 tips, dismisses on Got it, never returns.

### Remote-to-desktop mode (existing UI, native shell)
- Native Capacitor wrap of `MobileApp.svelte`
- Detects native shell so the PWA install prompt is hidden (you're already in an installed app)
- "‹ Switch mode" link returns to the mode picker

### Mode picker (first-launch)
- Two-button welcome screen — **Standalone** (default-styled, glow border) vs **Remote to Desktop**
- Selection persists to localStorage; switch via header link in either mode

---

## File map

```
src/lib/components/
  MobileModeSelect.svelte        first-launch mode picker
  MobileApp.svelte               (existing) — Capacitor-aware extensions added
  StandaloneApp.svelte           main VJ surface (~700 lines)
  StandaloneShaderPicker.svelte  bottom-sheet shader picker
  StandaloneProjectionMap.svelte 4-corner warp overlay

src/lib/mobile/
  standaloneAudio.ts             Web Audio → uniform set + beat detection
  standaloneRenderer.ts          WebGL ISF runner (no Three.js)
  standaloneShaderList.ts        30-shader registry
  standaloneHomography.ts        4-point projective warp math

src/main.ts                      Capacitor branch + mode-routing logic

docs/mobile-shader-curation.md   audit of all 483 shaders → 36-pick list
MOBILE_PROGRESS.md               this file
MOBILE_SUBMISSION.md             store submission step-by-step

capacitor.config.ts              bundle id, app name, native config
ios/                             Xcode project (icons + splash generated)
android/                         Gradle project (icons + splash generated, adaptive icon background fixed)
assets/                          source images for @capacitor/assets
```

### Capacitor plugins used
- `@capacitor/core`, `@capacitor/cli`, `@capacitor/ios`, `@capacitor/android` (v8.4.0)
- `@capacitor/assets` (devDep — generated all the platform icons + splashes from `assets/icon-only.png` + `assets/splash.png`)

---

## Verified on both sims

| | iPhone 17 sim | Pixel 8 emulator |
|---|---|---|
| First-launch mode picker | ✓ | ✓ |
| Standalone Frequency Rings / Ember Drift render at 60fps | ✓ | ✓ |
| VJ UI (top bar + crossfader + clip grid) | ✓ | ✓ |
| Blend mode picker | ✓ | ✓ |
| Onboarding overlay first-launch | ✓ | ✓ |
| Splash teardown after mount | ✓ | ✓ |
| App icon present | ✓ | ✓ |

**Untested on simulators (need physical devices):**
- Mic → audio uniforms → live shader reactivity (sims don't have audio input)
- Touch projection mapping handles (sims work, but mouse simulation is imperfect — finger drag is the real test)
- Battery drain over a 10+ min session
- USB-C → HDMI mirror behavior into a real projector

---

## What's deferred (and why)

| Feature | Why deferred | Effort to add |
|---|---|---|
| WebRTC phone → desktop video stream | Needs both ends developed + tested together. Requires desktop-side receiver in `App.svelte` that treats incoming stream as a layer source. Multi-day project. | 1-2 weeks |
| Native HDMI-out / external-display plugin | Custom Capacitor plugin = Swift + Kotlin. iOS `UIScreen.didConnect` + Android `MediaRouter` + `Presentation`. Must be tested on physical hardware with a real adapter. | 1 week |
| Per-shader specific audio injection patches | Currently using a universal patch (gl_FragColor *= 1 + audioBeat). The audit doc has 16 per-shader targeted patches that'd be more nuanced. | 2-3 days |
| Real shader thumbnails in the picker | Currently shows colored category gradients with a letter. Generating real thumbnails requires running each shader headless at build time. | 1 day |
| Sub-slots / clip banks (more than 9 pads) | Desktop has 36 — phone needs scrollable pages | 1 day |
| MIDI / external controller input | Phones don't have native MIDI without USB OTG. Defer to Bluetooth controllers. | 1 week |
| Account / cloud preset sync | Free-forever / no-account decision rules it out unless that changes. | N/A |

---

## What's left for the user (external blockers)

These are the **only** things that prevent shipping today, and none of them are coding tasks:

1. **Apple Developer Program** — $99/yr, 24-48 hr approval. https://developer.apple.com/programs/
2. **Google Play Console** — $25 one-time, 24-48 hr verification. https://play.google.com/console
3. **Real-device testing** — plug in an iPhone + an Android phone, confirm mic + projection mapping work
4. **Privacy policy URL** — host on ghostarcade.live, declare microphone usage
5. **Store screenshots + listing copy** — `PRODUCT_OVERVIEW.md` is good source material
6. **Android keystore generation + signing config** — 30 min, instructions in MOBILE_SUBMISSION.md

Full step-by-step in **MOBILE_SUBMISSION.md**.

---

## Background project memory references

- `project_ghost_arcade_mobile.md` — Full project scope + hard NOs
- `feedback_mobile_shaders_audio_reactive.md` — Audio-uniform set + reactivity defaults (corrected per 2026-06-03 audit)
- `feedback_autonomy.md` — In-repo work proceeds without permission prompts
- `feedback_system_install_permission.md` — Brew / system installs require permission
- `project_website_deploy.md` — ghostarcade.live deploy quirks
- `user_git_config_email_broken.md` — Global git email corrupted; set local user.email per repo

---

## Final task status

| ID | Subject | Status |
|---|---|---|
| #1-7 | Phase 0 wiring | ✅ |
| #8 | Brew installs (Android Studio + JDK) | ✅ |
| #9 | Xcode install | ✅ |
| #10 | Shader audit → curation doc | ✅ |
| #11 | Standalone renderer + shader list | ✅ |
| #17 | Phase 0 verification on both sims | ✅ |
| #18 | First-launch mode picker | ✅ |
| #19 | Boot router honors mode selection | ✅ |
| #20 | AUGMENT patches + shader picker UI | ✅ |
| #21 | Touch VJ UI (clip grid + crossfader + blends) | ✅ |
| #22 | Touch projection mapping | ✅ |
| #23 | Clean Output mode | ✅ |
| #24 | WebRTC stream to desktop | DEFERRED (v2) |
| #25 | Icons + splash + onboarding | ✅ |
| #26 | Submission docs + signing flow | ✅ |
