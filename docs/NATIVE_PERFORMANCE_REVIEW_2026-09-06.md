# Native renderer performance and live reliability review

Implementation follow-up: [changes, validation and qualification limits](NATIVE_PERFORMANCE_IMPLEMENTATION_2026-09-06.md). The findings and measurements below preserve the pre-implementation baseline.

Reviewed 2026-09-06 against `a2ffde53`, Ghost Arcade 2.0.3. The latest native-core change is `69411ee1` (persistent composition FX). This is a review and implementation plan; application source was not changed. The pre-existing edit to `src/lib/mcp/mcpTools.ts` was left alone.

## Decision

Prioritize output correctness, memory ownership, and bounded work before increasing rendering throughput. The current renderer has useful safeguards, but it is not ready for a claim of leak-free, interruption-free operation over a long live set. Several failures below were reproduced on the GPU; others are established allocation/lifecycle paths that still need soak testing to quantify their impact.

The largest measured throughput problems are the multi-layer compositor, full-resolution effects, and repeated composition for extra outputs. CPU render-time telemetry substantially understates other work that can block the render thread. Low reported CPU milliseconds therefore do not establish adequate live-performance headroom.

## Scope and evidence

Inspected the Rust event loop, compositor shader, compute/render graph execution and caches, quality controller, image/video decoding, shared textures, Electron broker and native preview addon, source synchronization, preview/deck/slice pumps, and live recording/capture path. Examined teardown, overload, source replacement, and output removal paths. Windows handle ownership was inspected in source; Windows execution was not tested.

Validation performed:

- Current release build succeeds. Rust tests rerun in this review: 50 passed.
- Expanded selected TypeScript/JavaScript checks in this review: 96 passed across six files covering broker, sync, clearing, geometry, renderer store, and composition effect coverage.
- Existing performance benchmark ran on Apple M1 Max / Metal after enabling macOS graphics-service access. The initial sandbox-only run failed at startup; that was an environment limitation, not a renderer performance result.
- Isolated review probe reproduced blackout failure, snapshot divergence, stale slice allocation, accumulating shader pipeline variants, ineffective command drain limits, and broker write-buffer retention after timeout.
- Additional short GPU workloads measured layers, effects, readback, and slices. No four-hour soak, representative video/camera rig, physical-projector cadence capture, or Windows GPU run was completed. No claim of measured bytes-per-hour leakage is made.

Raw evidence and reproducible probe: [review evidence](reviews/native-renderer-2026-09-06/README.md).

## Measured baseline

These are short local observations in isolated core processes, not hardware capacity guarantees. Completed FPS comes from core submission-completion counters, not an external display measurement. The two groups use different quality policies and should not be treated as an A/B comparison. Reported CPU/GPU times are existing EMA telemetry, not full frame-time percentiles.

| Existing benchmark: 1920×1080, fixed/native quality, target 120 FPS | Completed FPS | Reported CPU EMA | Reported GPU EMA |
|---|---:|---:|---:|
| One color layer | 82.8 | 0.625 ms | 3.030 ms |
| Planet native graph | 24.2 | 0.800 ms | 26.760 ms |

| Review probe: 1920×1080, performance policy, 1024 source frames, target 60 FPS | Completed FPS | Backpressure skips in ~4 s |
|---|---:|---:|
| One translucent color layer | 53.7 | 10 |
| 16 overlapping translucent layers | 28.1 | 113 |
| 16 layers + blur/invert/pixelate/brightness | 18.9 | 150 |
| Same, requesting full-output readback at up to 30 Hz | 19.9 | 1 |
| Same, no readback, two extra 1080p slices | 12.4 | 177 |

Readback averaged 48.2 ms, maximum 53.7 ms, with 81 completed requests in about four seconds. The readback case did **not** demonstrate a further FPS reduction relative to the preceding sample; it did demonstrate that 30 Hz requests could not be sustained, while the backpressure-skip metric fell despite poor throughput. This illustrates why skips and CPU EMA alone are inadequate health signals. The readback fixture excludes MP4 encoding and disk export costs.

## Findings and proposed changes

### R1 — P1: blackout is overridden by composition effects (GPU reproduced)

`heartbeat.wgsl:1861` applies the master gate before `main.rs:19106` runs composition FX. With invert enabled, requesting blackout produced an entirely white 160×90 output: mean RGBA `[1,1,1,1]`. Removing the chain while leaving blackout enabled produced black with zero nonzero pixels.

Apply the master gate after effects and overlays, at the final output stage. Decide and encode the order of creative effects, projector grading, edge blending/dome masks, and blackout explicitly. Effects after an edge mask can also brighten pixels that calibration intended to suppress. Test invert, noise, brightness, overlays, freeze/unfreeze, and blackout in every output route.

### R2 — P1: composition FX are missing from alternate output paths (partly GPU reproduced)

The same scene had output average luma 0.7941 and snapshot luma 0.2059: the output was inverted and the snapshot was not. `render_snapshot` (`main.rs:18908`) does not execute the persistent chain. Slice rendering (`16225`) and swapchain fallback (`19189`) also omit it by inspection. Snapshot preview geometry is deliberately different in places; that is not the defect.

Share the creative-effect stage, preserving deliberate per-output geometry and calibration. The fallback should present the finished mirror rather than rebuilding an incomplete frame. Add pixel tests for effect persistence across multiple core frames without another host submission, explicit clear, snapshot/export parity, and slice parity where their geometry is identical.

### R3 — P1: pipeline variants accumulate without eviction (GPU reproduced)

Graph pipeline keys contain the shader source hash (`main.rs:10987`), and `ensure_native_graph_render_pipeline` retains each variant (`17599`). Changing the same shader ID eight times grew the pipeline count from 1 to 9. All nine remained after removing the graph and layer, even with `pipeline_metadata_cache_cap` set to 2. The three GPU pipeline maps have whole-cache clearing, not incremental retirement.

The shader registry itself has an entry cap; do not confuse that with a bound on compiled pipeline revisions. This is growing cache retention rather than proof of an unreachable allocation leak. Introduce shader-generation ownership, pin variants used by active/pending graphs, and retire unused revisions under count and estimated-memory budgets. Avoid evicting active pipelines and causing compilation during a cue.

### R4 — P1: successful point-cloud loads retain large CPU buffers for the session (source confirmed)

`nativeRendererSync.ts:5697–5741` stores promises resolving to packed point-cloud buffers. Entries are deleted on error or full stop, not when a successful asset stops being used. Each asset retains home/live/sort buffers (`webgpuPointCloudFX.ts:1311`); home plus live alone is 160 bytes per point, about 38.1 MiB for 250,000 points. Cycling through different assets can accumulate substantial renderer-process memory.

`previewImageElements` similarly retains successful image objects until stop (`nativeRendererSync.ts:9777`). Actual decoded image residency depends on Chromium, so heap and process-memory measurements are needed. Shared-texture metadata also has explicitly unpruned entries, but those are much smaller and lower priority (`9063`).

Use byte-accounted caches with explicit active/cued references, a bounded warm pool, and eviction on source removal. Cancel obsolete loads or discard their completions using lifecycle generations. Audit all asset-bearing state maps on stop as well as layer removal; do not remove live capture handles merely because a cadence-gated poll did not touch them this frame.

### R5 — P2: removing the final slice does not free its GPU target (GPU reproduced)

`render_slice_outputs` prunes targets, but its caller runs only when the slice list is nonempty (`main.rs:9709`). After setting the slice list to empty, `slice_output_state` still returned the removed slice, unchanged surface handle and frame counter. Allocation is retained until a later nonempty slice update or renderer teardown; this is bounded retention, not unlimited growth from every close/open cycle.

Move lifetime reconciliation into `apply_slice_outputs`, including the empty-list case, and retire targets safely after GPU use. A slice owns render and export textures: roughly 63.3 MiB at 3840×2160 with two four-byte textures, before driver overhead. Assert zero slice targets after the last close.

### R6 — P1: memory budgeting omits major allocations and can evict active simulation state (source confirmed)

`estimate_source_frame_texture_bytes` (`main.rs:24699`) counts one base-level array. Initialization actually creates two mipmapped 24-layer arrays and a third base-level array (`15057`, `15078`, `15482`). At 1024 RGBA8 with five mip levels those arrays total about 351.8 MiB, versus a 96 MiB single-base-array estimate; at 1536 they total about 791.4 MiB, versus 216 MiB. Depth, output, slice, preview, graph buffers and driver allocations are additional. These are arithmetic allocation estimates, not measured resident memory.

`vram_budget_mb` and `texture_pool_cap_mb` primarily determine a graph-buffer allowance (`11065`), not a total allocation limit. Shader/pipeline metadata limits and decode upload/handoff limits are stored and reported without corresponding enforcement in these allocation paths.

Worse, graph-buffer pruning sorts by ID and removes buffers until under budget (`17800`), without excluding active simulations. Builders may reseed missing buffers, causing visible resets and repeated allocation under sustained pressure. Some graph paths can instead encounter missing resources.

Build one allocation ledger with class, owner, bytes, active references and last use. Admit the next cue before allocation; pin active and incoming resources. Evict complete inactive assets, not arbitrary buffers within an active simulation. If the rig exceeds budget, preserve the current output and reject/defer the incoming cue or use an explicit lower-quality version. Validate policy values against actual enforcement.

### R7 — P1: command limits do not bound work; timeouts do not bound queued bytes (reproduced)

`apply_commands` (`main.rs:4998`) increments a limit-hit counter but then applies the entire batch. A configured drain limit of 2 still applied all 10 probe commands. The advertised queue capacity does not limit the stdin/event queue. `NativeRendererBroker.send` (`electron/native-renderer-broker.js:1716`) ignores writable backpressure; removing a timed-out request does not remove bytes already queued to stdin.

A blocked-writable fixture with a 1 KiB high-water mark retained 108,492 bytes after all 100 request promises timed out and the pending map was empty. This is a controlled transport reproduction, not a measurement of normal traffic.

Bound request count and bytes, honor drain, and coalesce replaceable updates before writing. Preserve ordering for source ownership, remove, clear, cue and clock transactions. Add cancellation/epoch handling for obsolete queued work and a priority path for blackout/freeze. Split heavy preparation across time-budgeted ticks without exposing half-applied scene transactions.

### R8 — P1: decoding, shader creation and capture can block the render thread (source confirmed; readback measured)

Image decoding/resampling is synchronous (`main.rs:13195`, `14295`); first-use pipelines are created in rendering (`17599`). Full output readback allocates a buffer, waits indefinitely for mapping, copies pixels and computes frame metrics (`24975–25042`). Export then writes the file synchronously (`10088`). The broker also uses synchronous temporary-file writes for frame handoff (`1868`). Recording's serialized pump bounds overlap but does not remove these stalls.

Move decode and file I/O to bounded workers. Prepare pipeline variants before cue activation. Use a small asynchronous readback ring with completion callbacks and a bounded encoder queue. Drop recording/capture work when late while preserving presentation, and maintain wall-clock recording duration. Stop computing full-frame diagnostic statistics for every recording frame unless needed. Treat disk-full, slow encoder and blocked decode as recoverable per-job failures.

### R9 — P1: video memory and failure containment need stronger limits (source confirmed)

Each stream has eight queued RGBA frames plus a producer frame (`media_decode.rs:80`, `233`). At 3840×2160 that is about 284.8 MiB per stream; sixteen sessions could hold about 4.45 GiB of raw frames alone. Typical decode dimensions can be smaller; this is an allowed-resolution scenario, not observed usage. Session caps can also be exceeded while pending bindings protect every candidate (`main.rs:13425`). Standby FFmpeg processes and codec memory are extra.

The stderr drain uses `read_to_string` until process exit (`media_decode.rs:179`), retaining all decoder error output. One-shot FFmpeg `.output()` calls (`432`, `522`) have no deadline/cancel handle, so a stuck job can occupy decode capacity indefinitely. Full rings poll every 2 ms, including armed streams.

Budget aggregate decoded bytes before creating sessions; make preroll adaptive to resolution and cue needs. Reuse frame storage and use a condition variable instead of polling full rings. Keep bounded stderr tails plus counters. Add decode deadlines, cancellation and process-group cleanup. Include corrupt/truncated files and unavailable media in tests.

### R10 — P1: video falls behind after sustained stalls (source confirmed)

Streams decode at a fixed 60 FPS, but `drain_native_video_streams` pops one frame per due visit (`main.rs:13321`). When late, it resets the next deadline without dropping to the current source time. Frames carry no presentation timestamp (`media_decode.rs:33`). If the loop cannot consume 60 frames per second, sequential queued video can lag the transport and external beat clock rather than catching up.

Carry source timestamps, choose frames against the native clock, discard obsolete frames and count drops. Bound catch-up work, and reanchor/reseek only when necessary. Exercise 30/60/120 Hz output, rate changes, loop boundaries, and 100–500 ms stalls; verify transport alignment rather than just decoder throughput.

### R11 — P1 performance: the compositor repeats expensive work per pixel and per output (measured bottleneck; mechanism inspected)

The heartbeat fullscreen shader iterates scene layers and applies warp/shape/mask/effect work (`heartbeat.wgsl:1710–1861`). Extra slice outputs repeat scene composition. The 16-layer and two-slice fixtures performed much worse than the one-layer fixture.

Start with cheap bounds rejection and paths for ordinary unwarped color/textured quads; precompute invariant geometry. Evaluate mesh rasterization/scissors or tile-based layer lists before replacing the existing compositor. Preserve blend order, masks and mesh parity. Consider composing once then transforming slices only where master resolution provides adequate detail; retain per-slice full-resolution rendering when required. Benchmark representative blend/warp cases, not just opaque rectangles.

### R12 — P2 performance: avoidable work is still repeated each frame (source confirmed)

Resident composition jobs are cloned (`main.rs:9584`), transient uniform buffers and bind groups recreated (`17061`, `17242`), and the host rebuilds the graph every flush (`nativeRendererSync.ts:8223`). Array-sampling graph passes can copy all 24 source slots and all mips (`main.rs:17430`). The native presenter reimports the same IOSurface as a Metal texture on every draw (`native_preview_addon.mm:334`). Non-source depth targets are transient (`main.rs:17284`).

Retain graph topology, uniform buffers, views and bind groups keyed by resource generation; send uniform changes separately. Copy only actual read dependencies while preserving feedback semantics. Cache presenter imports until handle/size/generation changes. Pool depth targets. Fuse adjacent simple color operations and evaluate lower-resolution blur where visual tests permit. Optimize the planet's expensive procedural work using GPU pass measurements and explicit quality controls; do not promise a specific FPS gain before profiling.

### R13 — P1 observability: adaptive quality misses significant work (source confirmed)

The CPU render timer starts after ISF rendering and native graph preparation (`main.rs:9651`); video decode/upload pumping happens outside it (`14797`). The tracked main submission precedes separate deck and slice submissions (`9660–9730`). GPU queries omit work outside their encoder and may cover only the compositor when encoder timestamps are unavailable. Composition jobs are absent from native graph task accounting. Quality uses GPU EMA instead of CPU EMA once available (`native_quality.rs:144`), and observes only successful rendered frames.

Measure whole-loop and per-phase time, queue delay/bytes, displayed frame intervals, dropped/late frames, capture/decode latency, aggregate resource bytes, process memory, and all GPU submissions. Report sample age and timing coverage. Include failed/skipped deadlines in health and adaptation. Prefer reducing optional preview/capture work before touching the live program; use hysteresis and a manual quality lock.

### R14 — P2: recovery paths deserve explicit lifecycle tests (source confirmed risks)

Broker exit callbacks unconditionally clear `this.child` and reject all pending requests (`electron/native-renderer-broker.js:1918`); a late exit from an old process could invalidate a newly started process. Bind callbacks and pending requests to a process generation and await old-child termination before replacement.

`ensure_renderer` leaks the window before renderer initialization succeeds (`main.rs:3192`). Normally this is one process-lifetime allocation, but repeated initialization failures can retain additional windows. Replace the lifetime workaround with owned/shared window lifetime management. Add bounded device-loss/initialization recovery and preserve the last displayable frame where possible. Do not automatically restart the program output repeatedly during a show.

## Safeguards already present

Keep these protections while optimizing:

- One tracked main GPU frame in flight and a retry for the final clear frame.
- Video frame cache capped at 48 entries / 192 MiB; bounded per-stream rings.
- Stream drop/stop kills decoder children; producer cleanup reaps current and standby processes.
- Orphan-source cleanup and removal of graph-owned persistent buffers.
- Serialized host flush, late-trigger revision checks, and guarded preview/deck/slice polling.
- Recording pumps avoid overlapping captures; encoder paths clean temporary files.
- Inspected IOSurface lookup/release and Windows export/import close paths have explicit ownership handling. No blanket claim of a native handle leak is justified from this inspection.

## Implementation sequence

| Batch | Work | Exit requirement |
|---|---|---|
| 0 — Establish regression fixtures | Convert the review reproductions into asserting tests; record baseline frame intervals and resource counts | Each known failure fails before its fix; instrumentation states what it does and does not cover |
| 1 — Protect the show | R1/R2 output ordering and parity; R5 empty-slice cleanup; process-generation recovery from R14 | Blackout stays black, effect persistence/clear works, alternate outputs match their contract, closed slices disappear |
| 2 — Bound memory and ingress | R3/R4 cache ownership, R6 allocation admission/pinning, R7 byte/count limits, R9 byte-budgeted preroll and bounded stderr | No active-state eviction; memory plateaus for a fixed working set; slow core cannot grow transport queues without bound |
| 3 — Remove blocking live work | R8 worker decode/I/O and asynchronous capture; R9 cancellation; R10 timestamped playback | Slow storage/encoding/media affects its own job; program and transport remain responsive |
| 4 — Improve throughput | R11 compositor specialization; R12 retained GPU resources, dependency copies, shader quality work | Measured gains in reference rigs with image parity and no memory/cue regressions |
| 5 — Qualify releases | R13 complete health metrics and adaptive policy; long-session and failure-injection matrix | Documented supported rig at its target FPS on each supported backend |

Ship these as separately reviewable changes. Do not combine a compositor rewrite, memory-ownership changes and playback-clock changes into one patch. Snapshot/golden parity and manual-clock determinism are required after each relevant batch.

## Live-performance validation plan

Use real rigs: mapping and VJ modes; 1080p and 4K; 1/8/16 layers; normal/add/multiply plus masks and mesh warps; 0/1/4 effects; planet and stateful particle/fluid/point-cloud graphs; 2/4/8 video sources; camera/shared texture inputs; preview, two deck monitors, 0/2/8 slices; recording off/on. Test live 60 FPS and 30/120 Hz variants. Fix the output and quality policy for comparisons, warm caches first, and record hardware, power/thermal state, display configuration and background load.

Run a four-hour representative set and a separate churn test of at least 1,000 cue/source replacements. Repeatedly add/remove point clouds and images, reload shader revisions, create/close all slices, seek/scrub, switch projects, resize outputs and start/stop recording. Sample Electron main/renderer and core RSS, allocator/heap samples, application-owned GPU bytes, cache entries/bytes, FFmpeg child counts, handles, temp-file bytes, queued bytes and frame-time histograms every 1–5 seconds. Graph memory after warmup and after returning to the same working set; allocator/driver high-water retention must be distinguished from increasing live allocations.

Inject corrupt media, slow/blocked decode, slow/disk-full recording, overloaded command ingress, missing camera/shared texture, display disconnect/reconnect, and renderer exit/restart. Use a disposable test process for failure injection. Avoid stress-killing the live application.

Proposed release gates, to calibrate against the approved reference rig:

- Zero blackout leaks, wrong-source flashes, persistent stale output after clear, or silent active-simulation eviction.
- Warm cues reach the correct frame within 50 ms under the approved workload; cold cues keep the old output until ready or report a bounded failure.
- For the rig advertised as 60 FPS: p99 displayed-frame interval ≤25 ms, p99.9 ≤50 ms, and no >100 ms freezes during steady playback or warm cues. Equivalent refresh-relative targets apply to other rates. Report distributions and worst events, not average FPS alone.
- No sustained growth in live asset counts/bytes after a fixed working set stabilizes. All cache, queue and preroll byte caps are enforceable and visible; post-churn memory converges to a documented plateau.
- Closed slices and removed asset owners disappear from resource inventories. Decoder processes return to the allowed active/armed set within a bounded cleanup window; obsolete jobs do not occupy capacity indefinitely.
- Capture/recording overload drops or duplicates recording frames as specified while preserving program cadence and wall-clock duration.
- Repeat on Metal and Windows D3D12, including lower-memory hardware. Linux/backend-specific output limitations need separate qualification before extending these claims.

Completion means the reproductions are fixed and these gates pass on a stated rig. Short successful unit tests or one high average-FPS result are insufficient evidence of live-show reliability.
