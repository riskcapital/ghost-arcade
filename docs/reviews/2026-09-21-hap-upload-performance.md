# HAP upload overhead and macOS helper visibility

The live installed 2.0.9 app was profiled with four 1080p HAP clips. Its renderer main thread spent substantial sampled time in `queue.write_texture` staging copies/allocation and encoding video conversion/mipmap passes. GPU timing alone understated the CPU-side upload cost.

Changes:

- Reusable wgpu staging belt for BC blocks, with correct padded block-row pitch. Remapping is deferred until GPU completion; no CPU wait or reuse of an in-flight upload.
- One command encoder for the HAP frames drained together, preserving frame-memory leases through GPU completion.
- Removed unused video mip generation. Live source sampling is already clamped to mip zero; static-source behavior is unchanged.
- Reused the decoder's packet-read allocation. Snappy unpacking and a copy into GPU staging memory remain CPU work; this is not a zero-CPU decoder.
- Set the macOS renderer's activation policy to Accessory, disable its default menu and launch-time foreground activation. It can still own output windows but has no separate Dock icon.

## Measurements

Sequential runs of `scripts/hap-upload-bench.mjs` with the same four user clips, 1920×1080 output and 1024 source textures, after warm-up. The original app remained running during both runs. This isolates four-video decode/upload/compositing, not the complete frontend/effects/preview workload.

| Eight-second measured interval | Before | After |
| --- | ---: | ---: |
| Renderer process CPU seconds | 3.21 | 2.30 |
| Process CPU utilization (one core = 100%) | 40.12% | 28.73% |
| HAP frames handled | 480 | 480 |
| Output frames | 240 | 240 |
| Decode failures | 0 | 0 |

About 28% less renderer CPU time at identical measured throughput. This does not establish a full-app 60 FPS guarantee.

Validation: macOS release build; Windows x64 `cargo check`; 15 native GPU regressions covering HAP/HAP alpha/HAP Q colors, playback/seek/reverse behavior, continuous video effects (including H.264), and clip transitions. Windows runtime playback remains to be tested on Windows.

The installed application is not modified by these source/build changes; it must be relaunched with the new core or receive a new packaged build.
