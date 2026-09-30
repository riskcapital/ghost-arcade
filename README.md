# Ghost Arcade

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
[![Build](https://img.shields.io/badge/build-Vite%20%2B%20Electron-orange)](package.json)
[![Made with Svelte](https://img.shields.io/badge/Svelte-5-FF3E00?logo=svelte&logoColor=white)](https://svelte.dev)

**Ghost Arcade** is free, open-source projection mapping and VJ software for live visuals, stage design and creative installations. Mix videos and generative shaders, map them onto surfaces, perform to music, and preview the result in a 3D venue.

![Ghost Arcade VJ deck with live generative output, four clip rows, macros and effect controls](docs/images/ghost-arcade-vj-deck.png)

[Download the latest release](https://ghostarcade.live/download) · [Documentation](https://ghostarcade.live/docs) · [What's new in 2.0.13](https://github.com/riskcapital/ghost-arcade/blob/codex/windows-v2-testing/docs/releases/v2.0.13.md)

The desktop application is free and open source under AGPL-3.0, with no Pro tier or watermark.

## Current release highlights — 2.0.13

- **Projection mapping** — corner, mesh and Bezier warps; source cropping; curved and painted masks; screen slices; groups; edge blending; and independently configured display outputs.
- **Live VJ decks** — clip launching, dual decks and crossfade transitions, layer mixing, macros, snapshots, autopilot and beat-quantized triggers. Route live rows, groups or the deck mix onto mapped surfaces.
- **Looks and Edge Effects** — 22 coordinated beat-synced Looks, eight palettes, crisp borders, animated fills, path effects and group chases. Stack up to 16 Edge Effects per layer.
- **Native rendering** — the 2.x Rust/wgpu core targets Metal, DirectX 12 and Vulkan. Hardware video paths and GPU texture handling support responsive playback; performance depends on the device, media and effect workload.
- **Generative content and effects** — ISF/GLSL shaders with exposed parameters, multipass and audio inputs, GPU instruments, video and images, 3D models, point clouds and Gaussian splats. Apply effects at clip, layer and composition scopes.
- **Stage and projection simulators** — build a venue with screens, truss, PA and lighting, or place projectors around 3D objects to explore how content lands. Includes refreshed festival, club, arena and immersive venue templates.
- **Music and show control** — audio modulation, tap or typed BPM, MIDI Learn and clock, OSC, Ableton Link, cues, timecode, scheduling and projector control.
- **LED integration** — WLED plus Art-Net and sACN pixel mapping and DMX input. See release notes for hardware validation status and protocol limits.
- **Mobile companion** — pair a phone or tablet over the local network for touch VJ and mapping controls, with layouts adapted to each screen size.
- **Output and capture** — multiple display outputs, platform-dependent Syphon/Spout and NDI integration, live recording, layer/screen capture with supported alpha formats, and frame-locked offline export.

See the [release notes](https://github.com/riskcapital/ghost-arcade/blob/codex/windows-v2-testing/docs/releases/v2.0.13.md) for platform notes, performance limits and known issues.

> **Source branch note:** this default branch currently contains the legacy 1.9 source. The 2.x development source is on [`codex/windows-v2-testing`](https://github.com/riskcapital/ghost-arcade/tree/codex/windows-v2-testing). The setup instructions below describe this branch; use the download page for current packaged releases.

---

## Getting Started

### Prerequisites
- **Node.js** ≥ 20
- **npm** ≥ 10
- **Windows / macOS** (Linux works for browser-only mode)

### Install
```bash
git clone https://github.com/riskcapital/ghost-arcade.git ghost-arcade
cd ghost-arcade
npm install
```

> **Heads up:** `npm install` prints a handful of deprecation warnings (`glob@7`, `rimraf@2`, `boolean@3`, `core-js@2`). These are transitive dependencies of `electron-builder` and `butterchurn-presets` — packages we don't directly control — and they only affect install-time logging. The app builds and runs normally; you can ignore them.

### Run (Desktop — recommended)
```bash
npm run desktop
```
This boots Vite + Electron + the in-process LAN WebSocket server (port 9001) so the mobile companion can connect.

### Run (Browser only — no Spout, no native file dialogs)
```bash
npm start
```
Then open `http://localhost:1420`.

### Mobile Companion
1. Run the desktop app.
2. Click the QR-code button in the toolbar.
3. Scan with any phone on the same Wi-Fi.
4. The mobile UI loads from the desktop's built-in HTTP server (no app install needed).

### Build a Distributable
```bash
npm run build:desktop          # Windows installer
npm run build:desktop:mac      # macOS .dmg
```

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  Editor (Svelte 5 + Vite)                                         │
│  ├── Layer pipeline → effect chain → mesh warp → composite        │
│  ├── WebGL2 / WebGPU renderer (renderer/engine.ts)                │
│  └── ISF shader runtime, AnimationMixer, splat renderer           │
└──────────────────┬───────────────────────────────────────────────┘
                   │ canvas.captureStream(60) + WebGPU bridge
┌──────────────────┴───────────────────────────────────────────────┐
│  Output Window (Electron BrowserWindow)                           │
│  ├── Zero-copy WebGPU presenter (default)                         │
│  ├── WebRTC fallback                                              │
│  └── Spout sender (Windows native addon)                          │
└──────────────────────────────────────────────────────────────────┘
                   │ same-LAN WebSocket (port 9001)
┌──────────────────┴───────────────────────────────────────────────┐
│  Mobile Companion (same Svelte app, mobile route)                 │
│  └── Mapping warps, VJ clip launcher, freeze/play, macros         │
└──────────────────────────────────────────────────────────────────┘
```

Key directories:
- `src/lib/components/` — UI panels (LayerPanel, MediaTray, EffectPickerModal, VJModePanel, MobileApp…).
- `src/lib/renderer/` — WebGL2 / WebGPU engine, effect shaders, post-process passes.
- `src/lib/effects/` — effect catalog, parameter metadata, presets.
- `src/lib/stores/` — Svelte stores for layers, settings, vjClipLauncher, mediaLibrary, etc.
- `src/lib/isf/` — ISF parser + thumbnail generator.
- `electron/` — Electron main process, native dialogs, Spout bridge.
- `server/ws-server.js` — LAN WebSocket + HTTP server for mobile companion.
- `public/ISF/` — built-in shader manifest + .fs files.

---

## Contributing

Pull requests welcome. Please:

1. Sign your commits with `git commit -s` (DCO).
2. Run `npm run check` (svelte-check) before submitting.
3. Add a brief note to `CHANGELOG.md` describing user-visible changes.
4. For new effects: include a default preset in `src/lib/effects/effectUX.ts`, a catalog entry in `effectCatalog.ts`, and ParamMeta with sensible min/max/step defaults.

By contributing, you agree your contributions are licensed under AGPL-3.0.

---

## License

**Ghost Arcade** is licensed under the **GNU Affero General Public License v3.0** (AGPL-3.0-only). See [LICENSE](LICENSE) for the full text.

In short:
- ✔ Use it for anything — commercial gigs, installations, broadcasts, your bedroom.
- ✔ Modify the source.
- ✔ Distribute modified versions.
- ⚠ If you run a modified version as a network service, you must offer the source code to your users.
- ⚠ Derivative works must also be AGPL-3.0.

Output you create with Ghost Arcade (videos, livestreams, recordings) is **yours** and is not subject to AGPL.

---

## Acknowledgements

Built on the shoulders of giants:
- [Svelte 5](https://svelte.dev) — reactive UI.
- [Three.js](https://threejs.org) — WebGL/WebGPU rendering.
- [Electron](https://electronjs.org) — desktop runtime.
- [ISF](https://isf.video) — interactive shader format.
- [Šuvakov & Dmitrašinović (2013)](https://arxiv.org/abs/1303.0181) — three-body periodic orbit catalog used in the Geometric 3D pack.

Logo design + visual identity: Risk Capital Media LLC.

---

## Links

- **Website:** [ghostarcade.live](https://ghostarcade.live)
- **Website source:** [`riskcapital/ghostarcade-web`](https://github.com/riskcapital/ghostarcade-web) — separate Next.js repo. Download links live in `src/lib/release.ts` (`RELEASE_VERSION`); see its `UPDATING.md`. Details in [CANONICAL.md](CANONICAL.md#website).
- **Discussions:** [GitHub Discussions](https://github.com/riskcapital/ghost-arcade/discussions)
- **Issues:** [GitHub Issues](https://github.com/riskcapital/ghost-arcade/issues)
