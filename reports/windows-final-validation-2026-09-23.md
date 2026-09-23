# Windows validation — 2026-09-23

Base: `8d5fa30` (2.0.10), pulled by fast-forward on `codex/windows-v2-testing`.
Machine: Windows x64, NVIDIA GeForce RTX 4070 Laptop GPU, D3D12.

## Changes in this working tree

- Enable Windows NDI full-composition capture through an independent D3D11
  readback device. Find the exporting adapter, queue two staging textures,
  poll completion without waiting, and copy packed BGRA rows. Release/recreate
  resources on stop, resize and capture failure.
- Guard NDI output against stale asynchronous ticks after sender restart.
  Drain pending Windows frames even when the composition stops advancing.
- Preserve the previous NDI async-send buffer until the SDK releases it;
  reuse two buffers, pass the configured frame rate and disable SDK clock pacing.
- Recognize versioned Windows NDI SDK locations and installed runtime environment
  variables. Keep runtime DLLs excluded from public packages.
- Include Windows in the real plugin graph suite (its executable path previously
  omitted `.exe` and silently skipped this platform).
- Fix the generated Three.js catalog to respect Vite's asset base. The packaged
  Windows boot exposed an Embryo URL resolving to `C:\threejs` instead of the app
  bundle, despite the component fallback URLs already being corrected upstream.

## Results

- Native core release build and Windows native addons: passed. NDI sender addon
  was skipped because the SDK is absent; the DXGI capture addon built successfully.
- Rust: 134 passed, 2 ignored.
- UI/state/sync/WLED/NDI unit checks: 176 passed across 12 files.
- Packaged asset path regression checks: 3 passed, including generated catalog
  URL resolution under a Windows `file://` app path containing spaces.
- Windows hardware video, HAP, playback, LUT and DXGI capture: 51 passed across
  five runtime files. Real DXGI bytes matched the core's output snapshot,
  including odd-width row padding, updates, resize, release and failed-open recovery.
- Plugin graphs and effects: 38 passed on the isolated rerun. The initial run
  had six effect RPC timeouts with competing GPU tests and two Performer black
  snapshots; all passed when rerun without competing native test processes.
- Desktop typecheck: 0 errors, 1044 warnings in 63 files. Production frontend build passed.
- Packaged app: version 2.0.10; native core and DXGI addon SHA-256 match the tested
  artifacts. DXC DLLs and full FFmpeg are present. Packaged HAP, HAP Alpha and HAP Q
  conversion passed with PATH restricted to Windows System32.

### Actual Beeple clips

12 clips, four columns of three, 16 prepared column launches. All three sources
were ready in 5.68–14.98 ms; maximum core trigger telemetry was 4.665 ms.
No session evictions, software frames, hardware fallbacks or decode failures.
This measures native prepared-source readiness, not mouse-click-to-projector latency.
See `windows-beeple-twelve-grid-2026-09-23.json`.

### HAP sustained playback

Three independent 1920×1080, 60 fps sources, ten-second sample per format,
native compressed texture backend, 1080p output, 1024 MB decode budget.

| Format | Composition fps | Per-source fps | Dropped frames per source |
| --- | ---: | ---: | --- |
| HAP | 60.09 | 60.09 | 0, 0, 0 |
| HAP Alpha | 60.04 | 59.75 | 3, 3, 3 |
| HAP Q | 60.12 | 60.02–60.12 | 0, 0, 0 |

All formats passed the benchmark's >=59 fps criterion. All three tiles were
visible, with zero underflows, decode failures, software frames or hardware
fallbacks. Details are in `windows-final-hap*-2026-09-23.json`.

## Remaining NDI qualification

The Windows capture and output scheduling are tested. **NDI network output is
not yet qualified:** this machine has neither the NDI SDK nor runtime, so the
modified `ndi_addon.cpp` could not be compiled or exercised against the SDK.
The packaged app correctly reports that its NDI bridge is absent.

Install the official Windows NDI SDK, rebuild `electron/native`, then repackage
and test discovery, continuous moving video, resize and stop/restart in an NDI receiver.
Capture currently uses the core's existing concurrently shared output texture;
motion/frame coherence must also be checked before qualifying it for live NDI output.
`docs/ndi-setup.md` documents setup. Tests of capture or mocked sender APIs do
not establish that network output works. Mac runtime testing remains separate.

## Local test app

`C:\Users\justi\AppData\Local\Temp\ghost-arcade-final-20260923\win-unpacked\Ghost-Arcade.exe`

Unsigned local build; release signing was disabled in a temporary packaging
configuration. Source changes have not been committed or pushed in this task.
