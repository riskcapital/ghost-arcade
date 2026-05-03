# Ghost Arcade — Mac First-Run Checklist

Quick reference for pulling this branch onto macOS for development testing.
The app's primary dev environment is Windows; this doc covers the Mac-specific
gotchas that the agent review surfaced.

## Prerequisites

- macOS 12+ (Monterey or later — required by Electron 33)
- Xcode Command Line Tools: `xcode-select --install`
- Node 20+ (matches the Windows dev box)
- CMake 3.20+ for the native Syphon addon: `brew install cmake`
- Optional but recommended for system-audio capture: BlackHole or Loopback

## First-run

```bash
git pull
npm install                          # root deps
cd electron/native && npm install    # ── REQUIRED on Mac, see below ──
cd ../..
npm run desktop                       # vite dev server + electron
```

## Why the separate `electron/native` install?

`electron/native/` is its own npm package that compiles a C++ addon via
`cmake-js`. The root `npm install` does **not** recurse into it. On a fresh
clone you must run `npm install` inside `electron/native/` once, which kicks
off `cmake-js compile` via the package's `install` script and produces
`electron/native/build/Release/syphon_addon.node`.

If you skip this step, `loadSpoutAddon()` in `electron/main.js` returns null
and Syphon output is silently disabled. The rest of the app still works.

## Syphon framework

On the first build CMake will fail with a helpful error if `Syphon.framework`
isn't installed. Follow its instructions:

```bash
# Download from https://github.com/Syphon/Syphon-Framework/releases
sudo cp -R 'Syphon SDK 5/Syphon.framework' /Library/Frameworks/
```

Then `cd electron/native && npm run rebuild`.

## Known Mac differences from Windows

| Feature | Windows | Mac |
| --- | --- | --- |
| Texture sharing | Spout (DirectX) | Syphon (Metal/OpenGL) |
| System audio | WASAPI loopback | Requires BlackHole/Loopback virtual device |
| Code signing | Azure Trusted Signing | Apple Developer ID (`APPLE_ID` env) |
| Default fullscreen output | `fullscreen: true` | `simpleFullscreen: true` |
| Permissions prompts | None | Microphone + Screen Recording + Network |

## What to verify on first launch

- [ ] App icon appears (was previously broken because `electron/main.js`
      pointed at a deleted `src-tauri/icons/icon.png` — fixed in v17.1)
- [ ] File → Save (Ctrl+S / Cmd+S) on a project opened via the file picker
      overwrites the same .gha file (fixed `(file as any).path` regression
      from Electron 32+ removing `File.path`)
- [ ] Mobile companion: open `http://<mac-lan-ip>:9002` from your iPad on
      the same WiFi. macOS firewall may prompt — allow incoming connections.
- [ ] Keyframes panel: open in mapping mode, then enter VJ mode — keyframes
      tray should auto-close + the toggle button should hide
- [ ] VJ header: kill-output icon (red circle/slash) replaces "STOP ALL";
      performer atom icon (purple, slowly spinning) lives in the right
      side icon row

## Build a packaged Mac app

```bash
npm run build:desktop:mac:dir         # unpacked, no notarization
npm run build:desktop:mac             # full DMG, requires APPLE_ID env vars
```

Set `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` env vars
before running the full build for notarization. The unpacked `:dir` build
skips signing entirely and is fastest for dev testing.
