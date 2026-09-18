# Windows hardware video validation — 2026-09-18

Base: `fa510d986369b07c5255a01e6ecdf776868ed9dd`, v2.0.7, with the local Windows fixes described below. Host: Windows, NVIDIA GeForce RTX 4070 Laptop GPU, driver 32.0.16.1047; Intel UHD also present. The tested renderer selected the NVIDIA adapter and D3D12. Rust 1.97.1, Node 22.14.0, Electron 42.0.0, VS2019 Build Tools.

## Fixes found by physical GPU tests

- Progressive H.264 could be advertised as mixed interlace mode. Validate decoded sample interlace flags instead of rejecting the whole stream. Truly interlaced and unclassified mixed-mode samples remain rejected.
- Media Foundation's 100 ns timestamp quantization admitted one frame past an exclusive trim end. Apply a one-tick tolerance at that boundary.
- The HEVC decoder omitted its output color matrix while supplying primaries. Inherit the known source matrix before validating the negotiated format.
- DXVA padded a 960×540 video surface to 960×544. Accept padding only when the display aperture explicitly preserves the original image at origin zero. Genuine cropping and unexplained size changes remain rejected.
- Floating-point video-processor output darkened Main10 SDR colors on this driver. Use a precision-preserving RGB10 UNORM bridge for encoded SDR, retaining strict conversion-capability checks.
- Increase the HEVC test fixture from 128×96 to 256×192, above this driver's observed hardware size threshold. The tiny fixture returned a CPU-writable dynamic P010 surface; it was correctly rejected. Hardware tests retain all zero-software/zero-CPU-upload assertions.

## Results

- Native Windows release build and DXC setup: passed.
- Windows Electron addons (DXGI preview, Spout, capture, Link): built. Optional NDI SDK absent.
- Frontend production build: passed.
- Desktop type check: 0 errors, 1036 existing warnings.
- Video control tests: 33 passed across five files.
- Windows Rust video tests: 13 passed, 1 explicitly ignored fixture-based test. Runtime tests separately exercise hardware frame stepping.
- H.264 hardware runtime suite: all 19 scenarios passed, including first-picture colors, B-frame and variable-rate stepping, seeks, mouse/MIDI scrub bridge, held textures, loops, four simultaneous sources, 4K memory admission, and scratch-history reclamation.
- HEVC Main10 hardware runtime suite: 2 passed, full and limited range with pixel-reference comparisons and zero CPU video uploads.
- Transparency compatibility suite: 2 passed, correct compositing in automatic mode and explicit rejection in hardware-only mode.
- [Four-source synthetic benchmark](windows-hardware-trigger-benchmark-2026-09-18.json): 256 retriggers over 8 seconds, 1024 hardware frames, zero software frames, fallbacks, CPU video uploads or stream underflows. Command acknowledgment p95 5.13 ms; this is **not** controller-to-display latency.

Local detailed logs are in `scratchpad/windows-*.log`. Diagnostic fixtures are in `output/windows-video-validation/`.

The Electron development app was launched from this checkout and left open. Startup reached `backend=d3d12 ready=true`, NVIDIA RTX 4070, `previewAttached=true`, `failed=0`, and `shaderErr=none`; native DXGI preview presentation was active. One transient status-RPC timeout occurred during startup, followed by healthy status reports. Vite is serving on `http://127.0.0.1:1420`.

## Scope remaining

This qualifies the tested source build and NVIDIA driver for the automated scenarios above. Physical MIDI/controller latency, long-duration show workloads, real projector/output rigs, other vendors, adapter/device-loss recovery, and packaged/signed installers have not been qualified by this pass. HDR tone mapping, reverse playback, and GPU texture codecs remain outside this change.

## Reference

Microsoft documents per-frame interlace flags for mixed streams: [MFSampleExtension_Interlaced](https://learn.microsoft.com/en-us/windows/win32/medfound/mfsampleextension-interlaced-attribute). The encoded SDR bridge follows the [DXGI color-space definitions](https://learn.microsoft.com/en-us/windows/win32/api/dxgicommon/ne-dxgicommon-dxgi_color_space_type).
