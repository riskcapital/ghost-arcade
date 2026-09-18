# Windows native video qualification

The Windows hardware implementation has now been exercised on a physical NVIDIA RTX 4070 Laptop GPU (2026-09-18), using D3D12 and Media Foundation. See [the Windows validation report](../reports/windows-hardware-video-validation-2026-09-18.md) for fixes, results and remaining qualification. Packaged installers, other GPU vendors and extended show workloads still need separate verification.

## Run on Windows

Use a supported Windows 10/11 machine with a real D3D12 GPU and current vendor drivers. Media Foundation and the required codec must be available; HEVC may require the Windows HEVC codec extension. Put FFmpeg and FFprobe on PATH for test fixture generation. They are not used to decode the hardware test playback.

For a source checkout, install Node.js, Rust 1.96 or newer, and the Visual Studio C++ build tools. Run from the repository root. The native build also attempts to place the DXC shader compiler beside the executable; resolve any DXC setup warning before comparing cold-start performance, because its FXC fallback is slower.

```powershell
npm ci
node node_modules/electron/install.js
npm run native:build
npm --prefix electron/native install --ignore-scripts
npm --prefix electron/native run build
cargo test --manifest-path native-renderer/Cargo.toml windows_video
npx vitest run --config vitest.native.config.ts --maxWorkers=1 src/lib/renderer/nativeHardwareVideo.runtime.native.test.ts src/lib/renderer/nativeHardware10Bit.runtime.native.test.ts src/lib/renderer/nativeVideoFallback.runtime.native.test.ts
```

Launch the development app with `npm run desktop` after the build. Select your MIDI device in Settings → MIDI, then use **Ctrl+M → click the video timeline → move the knob/fader → Esc** to assign scratching. MIDI holds the selected frame until Play; mouse release resumes playback if the clip was playing before the drag.

HEVC qualification fixtures use 256×192 pixels. On the tested NVIDIA driver, 128×96 HEVC returns a CPU-writable dynamic surface even with D3D-required output; the strict hardware path correctly rejects it. Automatic playback may use compatibility decoding for such files. Do not weaken the GPU-only assertions to accommodate undersized fixtures.

Run the prepared-trigger benchmark with representative show media:

```powershell
node scripts/native-hardware-video-benchmark.mjs --input="C:/VJ/clips/show-test.mp4" --duration-seconds=30 --interval-ms=125 --budget-mb=1024 --output="reports/windows-hardware-trigger-benchmark.json"
```

The benchmark prepares four independent sources, forces hardware mode, measures engine command acknowledgments and checks playback counters. It does not measure controller-to-display latency. Use a high-speed camera with the actual controller, display, cabling and output settings for that measurement.

## Required evidence

- Every supported session reports `media-foundation`; the native source format is `NV12` or `P010`, and the upload transport is `native-video-dxgi`.
- Hardware tests have no software frames, fallbacks or CPU video-pixel uploads. Strict hardware failures are failures, not skipped tests. The alpha compatibility test explicitly expects fallback in automatic mode.
- First frames have the expected colors, including B-frame clips and Main10 full/limited range. No green, stale or uninitialized frame appears on a trigger or loop.
- Prepared retriggers, paused seeks, resume, short loops, trimmed loops and memory-pressure recovery pass. The held-texture case remains unchanged while other streams reuse their pools.
- Continuous mouse/MIDI scratch shows changing pictures during forward and backward movement, holds the final position, then resumes from it. Expanded scratch history returns its memory when another live clip needs admission. The runtime suite covers these cases; qualify them with a real controller and driver as well.
- Run with the app open under realistic multi-layer effects and outputs, for a multi-hour soak. Record drops, underflows, memory use, actual frame delivery and input-to-display latency.
- Repeat on NVIDIA, AMD, Intel and hybrid laptops. Confirm the decoder uses the render adapter. Test packaged/signed builds, missing codec behavior and recovery from display or device changes.

The prepared pool and its memory budget are bounded. Cold or evicted clips still require preparation; passing these tests does not establish zero-latency playback for every file. HDR tone mapping, reverse playback and GPU texture codecs such as HAP remain separate work.

## Implementation references

The source reader uses [D3D-required output](https://learn.microsoft.com/en-us/windows/win32/medfound/mf-readwrite-d3d-optional) and [passthrough mode](https://learn.microsoft.com/en-us/windows/win32/medfound/mf-source-reader-passthrough-mode) to expose unsupported CPU output rather than hiding it behind an upload. The GPU bridge follows Microsoft's [Direct3D 12 interop model](https://learn.microsoft.com/en-us/windows/win32/direct3d12/direct3d-12-with-direct3d-11--direct-2d-and-gdi) with [D3D11 producer fence signaling](https://learn.microsoft.com/en-us/windows/win32/api/d3d11_3/nf-d3d11_3-id3d11devicecontext4-signal).
