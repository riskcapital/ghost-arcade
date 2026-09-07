# Native renderer performance and reliability implementation

Implemented 2026-09-06 following [the review](NATIVE_PERFORMANCE_REVIEW_2026-09-06.md), against the local Ghost Arcade 2.0.3 checkout. The pre-existing `src/lib/mcp/mcpTools.ts` edit is outside this work. No commit or deployment was made.

## Changes

| Review | Implementation |
|---|---|
| R1–R2: output correctness | One creative master feeds the final output stage. Composition effects precede projector calibration, masks and blackout. Output snapshots and fallback presentation use that finished composition. A covered/minimized window or temporarily unavailable drawable no longer prevents shared-output rendering. Frozen output still responds to blackout. |
| R3: shader retention | Compiled pipeline maps now share a default 512-entry LRU cap; pipelines used in the current frame are protected. Graph pipelines compile through at most two background workers during live rendering. A cold pipeline retains the graph source frame and most recent ready composition chain, retries queued work, and continues rendering unrelated layers and output controls. Manual/offline graph execution remains synchronous. |
| R4: host asset retention | Point-cloud and image caches reconcile source ownership, release unused entries, clear on stop, and discard obsolete asynchronous completions. Point-cloud fetches can be aborted and streamed input has a byte limit. |
| R5: slice teardown | Slice targets are reconciled when configuration changes, including removal of the final slice. |
| R6: allocation admission | Source-array estimates include both mipmapped arrays and the base array. Active graph buffers are pinned and their combined allocation is checked before encoding. Output and slice dimensions have aggregate byte checks before allocation. |
| R7: command overload | Broker writes honor stream backpressure, bound queued bytes/requests, and remove timed-out unsent work. Core ingress is bounded. Transactions exceeding the command limit are rejected before any command is applied. Attached output gets a render opportunity during sustained RPC traffic. |
| R8: blocking work | Bounded workers handle live image decoding, graph compilation, exact video prefetch, output export and diagnostic output readback. Large broker payload files are prepared asynchronously and cleaned up on success, failure and timeout. GPU mapping/completion waits have deadlines. |
| R9–R10: video memory and timing | Video rings have a shared byte budget and small capacities, reuse raw frame buffers, and wait on a condition variable when full. FFmpeg output and stderr are bounded and one-shot decoders have deadlines. Playing sessions discard obsolete frames against the media clock; paused preroll does not advance. Explicit frame prefetch and live preroll are separate modes. |
| R11: repeated composition | Slices normally sample the completed creative master. Cropped/warped slices without graph composition effects, 3D meshes or overlays retain a direct-render path for detail. Plain color rectangles have a guarded compositor fast path; other layers keep the existing geometry/effect path. |
| R12: recurring allocation | Composition jobs share immutable storage, small fully initialized graph uniforms reuse a bounded buffer pool, output graph depth targets are reused, and the macOS preview addon reuses stable IOSurface/Metal imports. |
| R13: health measurements | CPU timing includes render preparation; adaptation considers CPU and fresh GPU measurements. Completion fences cover slices/decks. Stats include resource estimates, queue usage, video drops, worker counts, GPU sample age and submission interval tails. |
| R14: process/device lifetime | Command replies follow status publication, and child callbacks are tied to the originating process. Window/surface ownership uses `Arc` instead of a leaked allocation. A GPU completion timeout stops rendering with a recorded fault and requires an explicit core restart. |

## Default bounds and behavior

- Compiled pipelines: 512 entries; compilation workers: 2. This is a count limit, not a measurement of driver pipeline memory. Custom caps remain configurable.
- Source-array budget: 384 MiB for performance/balanced SDR, accounting for roughly 352 MiB at the established 1024-pixel size. The original 128/256 MiB estimates omitted two stores and mips; reducing to 512 pixels caused effect-golden differences, so the budget now reflects the existing sampling quality.
- Graph working allocation: 512 MiB by default; reusable small uniforms: at most 128 × 64 KiB.
- Output allocation estimate: at most 512 MiB at 24 bytes/pixel, with an 8192 dimension ceiling. Slice render/export targets: at most 8 slices and 512 MiB total at 8 bytes/pixel. These estimates exclude driver and swapchain overhead.
- Broker queue: 256 requests / 64 MiB. Temporary upload reservations: 64 MiB total, at most 16 concurrent writes. Core lines and ingress are also bounded at 64 MiB, with 256 queued requests.
- Image decoding: 2 workers / 64 queued jobs; prefetch waiters are bounded and expire after 5 seconds. Host decoded-image estimates are limited to 128 MiB; packed point-cloud buffers to 256 MiB, with a 512 MiB input limit and at most two simultaneous point-cloud loads.
- Video rings: 2–8 frames per session, sharing the configured decode-handoff allowance, capped at 512 MiB. Reservations include two additional working frames. Exact prefetch: 2 workers / 256 MiB; scrub decoding: 2 workers. FFmpeg stderr retains only its final 16 KiB.
- Live output export: one pending readback/export slot, at most 128 MiB of padded staging data. Diagnostic output snapshots have a separate slot with the same ceiling, so polling cannot take the recording slot. Additional requests receive a busy response. GPU mapping/completion deadline: 5 seconds. One-shot FFmpeg deadline: 10 seconds.

Raw core `prefetch_media` preserves live preroll by default; `prefetch_mode: "frame"` requests an exact timestamp. Manual-clock prefetch uses exact frames. Host synchronization explicitly requests `preroll`; broker library requests also default to preroll. Cold compilation can delay the appearance of a newly cued graph; the last ready chain stays active while other layers continue updating. Live cues should still be warmed before use.

## Validation

**`npm run native:full-check` completed successfully on the final source changes.**

- Desktop type checking: 0 errors; 1,036 existing warnings across 60 files.
- Rust: 55 tests passed. Windows cross-compilation passed.
- Native unit suite: 211 tests across 19 files passed. Graph and 3D integration gates each passed their overlapping 201-test / 28-file suites; these counts must not be added as distinct tests.
- Broker contract passed, including 21 graph executions. Preview/output pixel comparison had maximum delta 0.
- Deterministic frame sequence, 26 blend modes / 9 compositor effects, all 183 effect manifest cases, and 88 WGSL shaders passed.
- ISF corpus gate passed: 413/413 validated, 412/413 rendered in the harness; known blank cases are allowlisted.
- Final smoke passed. Its managed window was occluded and did not physically present, while shared-output and source-frame checks continued; this is not physical-display qualification.
- Native macOS preview addon rebuilt successfully with existing deprecated API warnings. `git diff --check` passed.

Reproduce the complete gate with `npm run native:full-check`; targeted reliability checks with `npm run native:live-reliability`. [Validation summary](reviews/native-renderer-implementation-2026-09-06/validation-summary.txt) identify the checked source/binary alongside the raw measurements.

## Measured results

Apple M1 Max / Metal, isolated release cores, 1920×1080, performance policy, 60 FPS target, **1024-pixel SDR source stores in both runs**. Each throughput sample lasts about four seconds; these observations are not statistically controlled capacity guarantees. CPU telemetry coverage changed, so old/new CPU EMA values are not directly comparable.

| Workload | Original completed FPS | Final completed FPS |
|---|---:|---:|
| One translucent layer | 53.7 | 54.2 |
| 16 overlapping translucent layers | 28.1 | 43.3 |
| 16 layers + four composition effects | 18.9 | 26.5 |
| Same + diagnostic output readback requested at up to 30 Hz | 19.9 | 24.5 |
| Same, without readback, with two extra 1080p slices | 12.4 | 25.0 |

The readback response averaged **59.0 ms** (maximum 84.3 ms, 66 requests), versus 48.2 ms originally. Moving mapping and pixel metrics off the render thread improves concurrent presentation but does not remove the GPU copy/wait cost or sustain 30 readbacks per second. Neither this test nor the file-export regression measures MP4 encoding.

The separate fixed/native-quality benchmark (1080p, 120 FPS target, five-second samples) measured 83.3 FPS for one color layer versus 82.8 originally, and 28.4 FPS for Planet versus 24.2. Planet remains well below 60 FPS on this workload; shader-specific optimization is still needed for that target.

## Retention and cold-shader stress

- A 1,000-revision shader/slice run plus 30 seconds idle took about ten minutes. The pipeline cap remained at 8 and final slice allocation was zero. RSS began at 193 MiB, peaked at 407 MiB and ended at 263 MiB. This shows bounded sampled retention in this fixture; it is not proof of no leaks.
- That run exposed a presentation flaw: continuously superseding a cold shader could keep the entire program on its last frame. It is preserved as `retention-1000-before-warm-fallback.json`, **not** presented as a passing final presentation test.
- The corrective fallback continues unrelated layers using cached graph source frames and the last ready composition chain. A subsequent 100-revision run verified submission progress and ended around 310 MiB RSS after a 400 MiB peak.
- The final 60-revision test additionally changes a plain color layer during compilation and verifies changing output checksums, increasing submitted frames, the 8-pipeline cap, zero removed-slice allocation, blackout/frozen blackout, output/snapshot parity, ordered output capture and atomic oversized-command rejection. Its maximum measured submission gap was **85.1 ms** under deliberate cold-shader churn. This is still a visible hitch relative to a 16.7 ms frame budget; shader registration/parsing and preparing cues remain relevant.

Raw results: [implementation evidence](reviews/native-renderer-implementation-2026-09-06/README.md). The 1,000-revision run predates the final fallback/readback adjustments; the shorter follow-ups validate those changes. A full long-duration run of the final build on the actual show rig is still required.

## Qualification limits and remaining optimization work

This implementation does not establish leak-free operation or a universal 60 FPS capacity. Resource ledgers are allocation estimates, not a complete accounting of Chromium, codecs, Metal or driver residency. Packed-asset byte caps exclude encoded-string representations and general heap overhead. Submission intervals and GPU completion counters do not measure physical projector presentation. Metal GPU timestamps cover the program render, while the completion fence includes additional output submissions.

The synthetic endurance fixture cycles shaders and slices. A representative four-hour show with actual videos, cameras, point clouds, recording, cue changes and attached displays remains necessary. Windows cross-compilation does not substitute for a Windows GPU/shared-handle run. Disconnect/reconnect displays, replace sources during decoding, test recording to slow storage, and confirm blackout/freeze through every physical output before qualifying a release.

Several deeper options in the review remain profiling work: shader-specific Planet/volumetric optimization, a full bind-group cache, composition-pass fusion, reusable capture staging rings, and reducing arbitrary texture-array dependency copies. The current implementation uses a single bounded asynchronous capture slot. Shader registration/parsing, ISF compilation, some metadata/file access, other offline/compute readbacks and host point-cloud parsing still include synchronous work. A blocked OS file operation can occupy a worker; worker/queue bounds prevent unlimited accumulation but cannot cancel every OS operation. Composition-effect/3D slices sample master resolution, so extreme crops may need a higher-resolution master. GPU faults require restart; automatic state recovery is not implemented.
