# Resolume parity: status, outstanding work and the full plan

Written and refreshed 2026-09-18. Current baseline: **2.0.8**, release commit
`8654d57a`. Covers the shipped playback and effect-chain work, what is left
open, and the four-phase plan to reach Resolume Avenue/Arena level. Earlier
diagnostics below are retained as engineering history, not current release blockers.

The comparison page behind the plan (filterable feature table, private
artifact): https://claude.ai/artifact/CAAf6CVKBLRdAGnsHx5ErC

---

## Product design standard

User direction, 2026-09-18: features must feel custom, intentional and highly professional, inspiring confidence during live performance. Placement and presentation are part of implementation and acceptance, not a later polish pass. Group controls by the action and scope they affect; keep performance controls immediately accessible and setup detail secondary. Use consistent spacing, typography and the existing visual language. Make selected, paused and unavailable states explicit with text or icons as well as color, preserve visible keyboard focus, and check compact layouts. Each feature needs an in-app visual and interaction review before UI acceptance is marked complete.

## Collaborative product exploration after parity

Once the parity acceptance work is complete, brainstorm with Justin before selecting the next feature set. The goal is a distinctive performance instrument serving both tightly audio-synced shows and fully improvised sets. Develop each idea together with its physical interaction, placement, feedback and recovery behavior—not as another settings panel. Explore phrase-aware performance planning, capturing and recalling gestures, constrained generative variation, and ways to rehearse or audition a change while keeping the live output under control. Compare candidates with the then-current Resolume and Wire capabilities before describing anything as unique. Prototype a small coherent performance workflow, test it in both scheduled and improvisational sessions, then choose what to build together.

## 1. Where things stand

| | State |
|---|---|
| Latest 2.x release | **2.0.8**, tagged `v2.0.8` at `8654d57a`, published and live on ghostarcade.live |
| Latest 1.9 (legacy) release | **1.9.995**, tagged `v1.9.995` on `hotfix/1.9.995`, signed and notarized, live as the legacy download |
| Shipped baseline | Hardware playback, prepared-frame cache, direct scrubbing/frame stepping, mouse/MIDI scratching, startup/transport fixes, 16-pass effect chains and the toolbar fit are included in 2.0.8 |
| Checkout for continued work | `codex/clip-transitions`, based on the pulled 2.0.8 release; unrelated local diagnostics remain separate |
| Resolume parity build | Phase 1 continues with layer and clip transitions. The three older paused worktrees in section 4 remain separate and unmerged |
| Next up | Column beat snapping, Normal/Toggle/Piano, layer Fader Start, Ignore Column Trigger and Layer Lock are implemented locally. Autopilot and eight video cue points are implemented locally; tempo nudge, phrase resync and per-clip launch overrides are also implemented locally. Controller lights and LAN pairing are now implemented locally. Continue Phase 2 video/media work. Windows runtime acceptance of the new transitions remains open |

### Current local feature: layer and clip transitions

Implemented on `codex/clip-transitions`, **not released**. The Layer and Clip tabs now expose 0–10 second duration and ten styles. Clips can inherit or independently override the layer duration and style; zero seconds preserves instant cuts. Both decks' settings survive project saves.

The native renderer holds the outgoing picture until the incoming clip has completed pixels, and captures the current mixed picture on the GPU for interrupted fades. Geometry, crop/fit and transparency remain consistent through completion, A/B mixing and mapped Screens. Mute, solo, Stop All, project reset and teardown retire retained state.

Mac development UI checks passed for a 10-second dissolve, a 1-second dissolve, successive mid-fade triggers including VideoToolbox video, a zero-duration clip override, separate style override, Stop All and saving the edited settings. Targeted store/coordinator/persistence, broker, shader and sync suites pass; desktop checking reports zero errors with existing warnings, and the frontend build passes. Native GPU and cross-platform compile results and the explicit source-memory increase are in the [transition validation report](../reports/native-clip-transition-validation-2026-09-18.md). Windows runtime, signed-build and sustained-load acceptance remain open.

### Current local feature: column beat snapping

Column buttons now use the existing launch quantization grid instead of bypassing it. OFF remains the default and launches immediately. A queued column has one deadline and commits every row in one launcher update; its button and cells pulse while waiting. Pressing it again cancels it, and selecting another column replaces the pending launch on that deck. Decks remain independent. A cell trigger replaces the pending column with that cell; later cell choices replace earlier choices on the same row.

Stop All, layer Stop, exit from live mode, block/mode changes, affected grid edits and disabling Deck B cancel pending work rather than allowing a stale launch. Empty columns retain their existing clear-layer behavior at the scheduled boundary. Quantization saves with the project; pending launches do not. Link uses its continuous native beat count for multi-bar boundaries instead of wrapped bar phase.

Validation: targeted launcher/persistence/transition and Link tests pass, including every launch grid, atomic row updates, cancellation, replacement, deck independence, stale-content rejection, transition start timing, save/load and Link bar crossings. The Mac UI showed both rows queued, then launched together; second-press cancellation and OFF immediate launching were checked. This uses the existing renderer-tick scheduling and keeps the deadline computed when queued; tempo changes while queued, physical controller-to-display latency and live multi-machine Link timing remain separate qualification work. The other trigger-behaviour items are not implemented by this step.

---

## 2. Shipped

### Ghost Arcade 2.0.8 (released 2026-09-18)

| Commit | Change |
|---|---|
| `fa510d98` | Native macOS/Windows hardware video, prepared retriggers, startup/loop fixes, direct scrubbing, exact frame stepping, continuous mouse/MIDI scratching and 16-pass effect chains. |
| `bb97237e` | Physical Windows GPU fixes and validation on an NVIDIA GeForce RTX 4070 Laptop GPU: interlace flags, trim timestamps, padded surfaces and Main10 SDR conversion. |
| `07905519` | Keep the full 2.0 toolbar accessible in narrow windows. |
| `8654d57a` | Release 2.0.8; [release notes](releases/v2.0.8.md). |

The published release is the baseline for continued work. Mac checks used an
Apple M1 Max; the [Windows validation report](../reports/windows-hardware-video-validation-2026-09-18.md)
records the RTX 4070 source-build qualification. Publication does not replace
packaged-installer, physical MIDI latency, other-vendor, full-resolution 4K
composition or long-show acceptance testing.

### Ghost Arcade 2.0.7 (released 2026-09-15)

| Commit | Change |
|---|---|
| `9a243872` | Settings > MIDI lists every mapping, grouped by control and named by layer and effect. Remove one, clear a control, clear all, and "Find a control" highlights the pad you press without firing it. |
| `a61f2e4b` | Flythrough and Pixel Particles: baked curl-field motion, Limit Wander, motion from the source, lit sphere grains with shadows, per-particle depth of field, and an Auto Camera that plans shots from a GPU contrast grid and can move on the beat. Adds `scripts/native-particle-bench.mjs`. |
| `22643781` | VJ STAGE mode. **Screen FX** now reach the output: the FX multiplier is applied to every native sync instead of one sync per frame that other stores overwrote. **Lower-row flash** on deck B trigger fixed: the core runs graph jobs in stage order (content, then crossfades, then the VJ Mix) instead of HashMap order, and the crossfade and mix pipelines compile at startup. Regression test `src/lib/renderer/vjNativeHandoff.runtime.native.test.ts` fails without each fix. |
| `e9a01502` | Windows editor preview lines up with its warp box on displays scaled above 100%. The DXGI presenter works in physical pixels and was given CSS pixels. **Not yet seen on real Windows hardware.** |
| `ca0df0a1` | A warped mesh stays applied after switching back to Corner warp, and corner pinning moves the warped picture. Corner mode shows Reset Mesh while a warped mesh is applied. |
| `a76a5a82` | Release commit, notes in `docs/releases/v2.0.7.md`. |

Website (`ghostarcade-web`): `0e62f30` moved the 2.x channel to 2.0.7 and added the changelog entry.

### Ghost Arcade 1.9.995 (released 2026-09-17)

- `5ecdf6da` The top toolbar fits narrow windows. Reported from a 2012 13" MacBook Pro (1280 px wide): Stage, Settings and Connect Mobile were past the window edge and Settings was unreachable. `fitToolbar` measures the bar and steps through four compact levels (tighter spacing, short labels and icon-only buttons, GPU pill as a dot, then a scrolling centre group). Verified at 1920, 1512, 1440, 1280, 1262 and 1200 px.
- `072fa76e` Release commit, notes in `docs/releases/v1.9.995.md`.
- Branch `hotfix/1.9.995`, worktree `.worktrees/1.9.991`.
- Website: `d8b72d2` points the legacy channel (`RELEASE_VERSION`) at 1.9.995. v1.9.993 and v1.9.994 stay published.
- GitHub marked v1.9.995 as the repo's Latest release; it was moved back to v2.0.7 with `gh release edit v2.0.7 --latest`. Do this after every 1.9 release (noted in memory).

---

## 3. Shipped implementation and validation history

The changes in this section shipped in 2.0.8. Test counts describe successive
implementation checkpoints and should not be added together. Early software-path
limitations remain relevant to compatibility playback; the later hardware sections
describe the default supported path. The physical Windows follow-up supersedes
the earlier Mac-only Windows compiler evidence.

### Seamless video looping

**Report:** "looping clips are super laggy in mapping mode. In VJ mode the clip showed a green screen for the first pass, the second pass showed near the end, the next pass was a little better but not a clean loop." Test clip: `Second_Nature_Wire_Circuit_8s_PREVIEW.mp4` (960x540, H.264, 30 fps, 8 s, a single keyframe at 0 s).

**Causes, all in `native-renderer/src/media_decode.rs`:**

1. Every pass of a loop launched a new ffmpeg process, started 0.75 s before the pass ended. On macOS a launch took anywhere from 40 ms to over 3 s. The unsigned `ffmpeg-static` binary is checked by `syspolicyd`, and the first launch from a new parent is slow. When the next decoder was late, the screen froze on the last frame and the producer then discarded frames to catch up. Measured freezes: 0.4 s to 3.2 s, each followed by a skip of 11 to 94 frames.
2. The playback clock started when playback was requested, not when the first frame existed, so startup time was skipped out of the clip.
3. Every clip was resampled to 60 fps, doubling decode, scale, pipe and upload work for 25 or 30 fps clips.

**Fix:**

- An untrimmed loop is one ffmpeg process with `-stream_loop -1`. No relaunch at the seam.
- The clock is re-anchored to the first decoded frame (`awaiting_first_frame` in `NativeVideoStream::try_pop`).
- Output rate is `min(source_fps * rate, 60)`, computed by ffmpeg itself (`fps=fps='min(source_fps*rate,60)'`). ffmpeg reports the chosen rate on stderr and the stderr reader hands it to the consumer clock, so no extra probe process is launched.
- Trimmed loops still restart ffmpeg each pass (`-stream_loop` always seeks to the file start and cannot loop a sub-range without decoding everything outside it), but the next pass's decoder now starts when the current pass starts, not in its last 0.75 s.
- `-t` is now an input option, so trims bound the source range correctly at playback rates other than 1.
- `GHOST_DEBUG_VIDEO=1` logs decoder spawns, first-frame timing, end of stream and the chosen output rate.

**Verified** with a frame-coded test clip in the same format as the report (every frame a unique colour, one keyframe), reading which frame the core shows:

| | Before | After |
|---|---|---|
| Loop seams (bare core and full app, mapping mode) | froze 0.4 to 3.2 s, then skipped 11 to 94 frames | last frame straight to frame 0, every 8 s |
| Decoder underruns | 504 in about 30 s | 0 |
| Start | first 12 to 25 frames skipped | starts on frame 0 |

`cargo test --release`: 71 passed, including new tests for first-frame anchoring and frame-rate parsing.

**Compatibility-path checks retained from this checkpoint:**
- Installed-build VJ verification; development-app startup and rapid triggering were checked in the follow-up below.
- The packaged Windows `ffmpeg-static` (package 5.3.0) accepts the `source_fps` expression. The macOS binary is ffmpeg 6.0 and does.
- Retest with the reported clip in the installed build, where ffmpeg is signed and should launch faster.

Test clip recipe (for regression checks):

```bash
node_modules/ffmpeg-static/ffmpeg -f lavfi -i "color=c=black:s=960x540:r=30:d=8" \
  -vf "geq=r='16+32*mod(N\,8)':g='16+32*mod(floor(N/8)\,8)':b='16+32*floor(N/64)'" \
  -c:v libx264 -pix_fmt yuv420p -g 1000 -keyint_min 1000 -sc_threshold 0 framecode.mp4
```

Frame index from an output pixel: `round((r-16)/32) + 8*round((g-16)/32) + 64*round((b-16)/32)`. A bare-core harness that plays one looping layer and logs seams and stalls was used for this; it lives only in the session scratchpad and is worth adding to `scripts/` alongside `native-particle-bench.mjs`.

### Native VJ startup and responsiveness follow-up (2026-09-18, shipped in 2.0.8)

These startup and responsiveness fixes are included in 2.0.8:

- Prevent a late scene prefetch from overwriting a live transport command or throwing away a prepared decoder. The urgent handoff now records transport state so the following scene sync does not repeat setup; failed handoffs remain retryable.
- Match prepared sessions to the requested in-point, preserve independent library sessions, and remove consumed library records so they cannot respawn accidentally. An early trigger adopts a decoder still preparing its first frame instead of starting another process.
- Replenish a triggered clip's prepared session as soon as its native handoff finishes; removed the arbitrary 75 ms delay.
- Keep four opening frames per prepared decoder rather than eight, so four HD rows and their four next triggers fit in the default decoded-frame budget. Playing sessions continue refilling their rings.
- Reclaim unused library preroll when the decode memory budget is full, preserving playing sessions. A full speculative cache must not permanently block a new live source.
- Bound each FFmpeg stream to two decoder threads, one filter thread and one raw-output thread. Automatic per-process thread pools multiplied across rows and delayed first output; a four-decoder comparison with the reported clip reduced warm process-to-first-frame time from 118–119 ms to 53–61 ms. [FFmpeg documents the default filter pool as one thread per available CPU](https://ffmpeg.org/ffmpeg.html#Advanced-options).
- Suppress the placeholder fill when a video has no decoded texture. A pending replacement keeps the previous picture until actual incoming pixels are ready.
- Use the same monotonic clock as the video transport anchors. Newly placed mapping videos start at their in-point, not the hidden browser preview's position.
- Make full-output diagnostic pixel readbacks opt-in (`__NATIVE_SCENE_DEBUG__ === true`). These readbacks were enabled by default and could block the interface for hundreds of milliseconds during a set.

The new `src/lib/renderer/nativeVideoPlayback.runtime.native.test.ts` covers startup races, in-point matching, separate warm sessions, missing-frame output, admission under a full memory budget, four playing rows plus four prepared retriggers, and three continuous loop seams. The loop test checks moving output, source cadence and zero decoder underruns. Sync tests cover clock domains, transport retry, and avoiding diagnostic output readback during ordinary reconciliation.

The isolated development app played the reported Wire Circuit H.264 clip and completed 12 repeated triggers at 125 ms spacing. In the final single-clip run, handoff acknowledgments were **1.1–8.5 ms**; every sampled trigger had a playing session with buffered frames. This is event-to-renderer acknowledgment, **not measured physical display latency**, and does not establish 4K or arbitrary-codec performance.

Four distinct file copies of the 960×540/30 fps Wire Circuit clip also played through a full loop in the app: all sampled output checksums changed, all four next decoder sessions became prepared, and decoder underruns stayed at zero throughout the measurement. With the final thread limits, the four-row column handoff took **10.8 ms**. Testing used an Apple M1 Max; the app decoded at its configured 1024×576 source size.

**Software-path result before the hardware follow-up below:** repeated four-row column retriggers at 125 ms spacing exceeded reliable preparation throughput. The final run acknowledged handoffs in 2.2–17.3 ms, but several status samples still had no first frame for the new sessions and the underrun counter increased by four. An acknowledgment is not proof of visible first-frame delivery. The earlier unrestricted-thread run reached 63.9 ms acknowledgments and added 13 underruns. Do not label this build instant under every live workload or ready for a professional show on these results alone.

The prepared pool remains bounded: the library pool retains at most six prepared decoder sessions, live playback at most sixteen locally (eight in 2.0.8), and the decoded-frame budget can reduce the resident pool further. Clips outside that pool can still incur cold-start latency. The macOS/Windows hardware paths and persistent opening cache are shipped as described below. The local HAP compressed-texture path is implemented below; multi-stream qualification and universal instant-playback coverage remain open. This is not a claim of Resolume performance parity.

Resolume's public documentation describes [GPU decompression for DXV](https://www.resolume.com/support/en/rendering-to-dxv) and its [native/OS video playback paths](https://www.resolume.com/support/en/video), but does not specify its complete clip-preload/cache policy. Do not assume it loads every entire clip into RAM.

Validation at this checkpoint: full default Vitest suite passed (897 tests); after the final decoder thread change, the 22 core/video tests passed again. Rust release tests passed (71), desktop type/Svelte checks passed with 0 errors (existing warnings remain), and the production frontend build passed. Both opt-in native graph integration tests passed after correcting an outdated Flythrough expectation: its first frame includes the persistent curl-field bake, subsequent frames do not. Later hardware load checks and physical Windows results are recorded below; signed installed-build acceptance and a long performance soak remain open.

### macOS hardware playback follow-up (2026-09-18, shipped in 2.0.8)

**Implemented and enabled by default on macOS:** compressed video samples go through a verified hardware VideoToolbox session, then retained Core Video IOSurfaces are imported directly into Metal. NV12 and 10-bit P010 color conversion, range conversion, scaling and atlas placement happen on the GPU. Supported live playback does not launch FFmpeg or copy raw video pixels through CPU memory. AVFoundation still demultiplexes compressed samples on a worker; this is hardware video decoding, not decoding H.264 in a shader.

- Keep the hardware decoder and asset open across seeks, loops and retriggers. Cache a bounded opening sequence so a prepared retrigger immediately submits an existing GPU surface; reposition the decoder on its worker. Reuse the opening sequence at matching loop in-points while the worker seeks.
- Use exact source presentation timestamps, including B-frame reordering. The video track's duration controls normalized trims, so stale browser duration metadata or longer audio cannot create a silent pause at each loop. Pause/resume preserves the current clock phase.
- Retain the pixel buffer and its memory reservation through Metal completion. Admit frames using their actual IOSurface allocation, including stride and bit depth; limit queued frames and GPU conversions. Waiting live clips can reclaim unused library preroll and continue after a budget increase. Retired sessions remain charged until their work and GPU references finish.
- Raise the default decoded-video handoff cap to 512 MiB, with explicit configurations honored up to 1 GiB. This is a limit, not an up-front allocation. VideoToolbox's opaque codec-reference storage and the renderer's atlas are separate allocations.
- Prevent App Nap while decoder sessions serve live output, and temporarily raise worker priority. A full-app background playback problem appeared after the bare-core tests passed; after scheduling protection and cached loop replay, the app sustained the test below without underruns or dropped frames. [Apple documents user-initiated activity as protection against App Nap](https://developer.apple.com/library/archive/documentation/Performance/Conceptual/power_efficiency_guidelines_osx/PrioritizeWorkAtTheAppLevel.html).
- Report the actual decoder backend, fallback reason, native pixel format, CPU/hardware frame counts, memory waiting state, dropped frames and transport timing. `GA_NATIVE_VIDEO_BACKEND=hardware` rejects unsupported clips instead of silently switching; `software` explicitly exercises the compatibility path; the default is `auto`.
- Preserve transparency and geometry by routing unsupported alpha-bearing formats, transformed tracks, non-square pixels and unsupported clean apertures to the compatibility decoder. This path supports 10-bit SDR conversion; it does not add HDR tone mapping or wide-gamut output management.

**Full-app evidence, Apple M1 Max:** four distinct files containing the reported 960×540/30 fps Wire Circuit clip played through two measured loop seams, with zero underruns and zero dropped frames. Then 64 column launches at 125 ms spacing produced **256 clip retriggers**, with handoff acknowledgments of **1.7–6.7 ms**. Every sampled launch had all four hardware sessions presenting frames; underruns remained zero. The final status, after another approximately 90 seconds of playback, showed zero underruns/drops/fallbacks, four live plus four prepared sessions, and **107.7 MiB** of application-owned decoded-surface reservations. These are engine/IPC timings, not camera-measured input-to-display latency.

Local detailed traces (not included in the source commit): `reports/native-hardware-app-verified-loop-2026-09-18.json`, `reports/native-hardware-app-retriggers-2026-09-18.json`, with a committed summary in `reports/native-hardware-app-final-status-2026-09-18.json`. Earlier failed diagnostic traces are retained separately; they are not the final result. The loop measurement uses shared-texture metadata rather than repeated pixel readbacks.

**Core load checks:** `scripts/native-hardware-video-benchmark.mjs` also exercised four 1080p60 sources and four 4K30 sources, each with 256 retriggers at 125 ms spacing. Both runs had zero underruns, software frames, fallbacks or CPU video-pixel uploads; maximum command acknowledgments were approximately 3.2 ms. The 1080p run used a 256 MiB handoff cap, the 4K run 1 GiB. Both used a **1024-pixel source atlas and 1080p output**: these checks prove native-resolution decoding and GPU scaling, not full-resolution 4K output quality. Local detailed reports (not included in the source commit) are stored under `reports/native-hardware-video-1080p60-benchmark-2026-09-18.json` and `reports/native-hardware-video-4k30-benchmark-2026-09-18.json`.

Regression coverage includes H.264 B-frame colors/order, limited/full-range HEVC Main10/P010, paused seeks, retriggers, full/trimmed loops at different rates, two-frame clips, stale host duration, alpha compatibility, strict-mode rejection, 4K memory pressure/recovery, and software admission while retired memory is still held. The hardware suites reject CPU video uploads and silent software fallback. Standalone shim checks also cover repeated seeks, cross-thread teardown, frame lifetime after decoder close, variable frame rates and a longer audio tail.

Validation at this hardware checkpoint: release core build passed; all 36 core/playback runtime cases passed; 83 Rust tests passed (four opt-in cases ignored in the ordinary run; the macOS shim hardware fixtures were exercised separately); 587 ordinary app tests and 88 targeted sync/effect tests passed. Desktop checks found zero errors with existing warnings, and the production frontend build passed. `git diff --check` passed. These changes were committed in `fa510d98` and shipped in 2.0.8.

**Remaining qualification and scope:** cold or evicted clips can still need preparation; the pool is bounded rather than loading every complete clip. Windows RTX 4070 qualification is recorded below; other GPU models/vendors, signed-package tests, full-resolution 4K composition, device-loss recovery during a set and a multi-hour soak remain open. The separate local HAP texture-codec implementation is described below; HDR color management remains open. Manual/offline frame capture and unsupported compatibility cases still use the existing FFmpeg path.


### First parity feature: longer effect chains (shipped in 2.0.8)

The shared limit is now 16 enabled passes for clip/layer chains, VJ composition FX and mapping composition FX. Extra enabled effects are bypassed with a visible warning in the effects panel; they no longer blank the working chain. Clip and layer effects share the combined chain's allowance. Disabled effects do not consume it. An unsupported effect beyond the limit cannot disable the first 16 supported passes.

Validated 12- and 16-pass chains in the real native core, including output pixels and intermediate-texture reuse; unit tests cover the 17th effect and disabled effects. This change adds capacity, not a guarantee that 16 expensive effects meet the frame budget on every machine.

### 2.0 toolbar fit

The same `fitToolbar` fix as 1.9.995, ported to 2.0 (`src/App.svelte`, `src/lib/utils/toolbarFit.ts`). On 2.0, "Mobile" was cut off at 1262 and 1200 px; it now fits there with only the tighter spacing, and is unchanged at 1440 px and wider. svelte-check 0 errors. Shipped in 2.0.8 as `07905519`.

---


### Windows hardware playback follow-up (2026-09-18, shipped in 2.0.8)

**Shipped and tested on a physical NVIDIA GeForce RTX 4070 Laptop GPU.** Media Foundation opens a persistent source reader on a worker, using a D3D11 hardware device created on the renderer's exact D3D12 adapter. H.264 and HEVC decode to NV12/P010 textures. A GPU video processor converts into pooled shared RGB surfaces; a shared GPU fence orders D3D12 sampling. Supported playback never maps, reads back, or uploads raw video pixels through CPU memory.

- Hardware status is set only after a real decoder-bound DXGI texture passes format, memory-access and device-identity checks. CPU output and software adapters are rejected. Automatic CPU-to-texture upload is disabled. Unsupported codecs, profiles, geometry, HDR/unsupported color metadata and missing hardware support use the existing explicit compatibility fallback in `auto` mode; `hardware` mode reports failure.
- NV12 uses BGRA8 conversion. P010 uses a precision-preserving RGB10 UNORM bridge for encoded SDR, with no 8-bit conversion downgrade. Physical testing found that floating-point video-processor output darkened Main10 on the tested driver, so `bb97237e` corrected this bridge. SDR matrix/range conversion targets the renderer's Rec.709 space; driver support is checked before use. Full HDR color management remains outside this implementation.
- Reuse the shared prepared opening cache, generation checks, media timestamps, pause/resume, loops, trim controls and memory admission. The source reader stays open across seeks/retriggers. A bounded compressed-tail timing probe during preparation excludes longer audio tails from the video loop duration.
- Each decoder owns its D3D11 context and converter, with best-effort Windows MMCSS Playback scheduling on its worker. GPU outputs, shared handles/imports and texture views are reused. Input samples remain retained until video conversion completes; immutable output frames remain retained through renderer completion. Producer retirement is bounded, and GPU waits have timeouts/device-removal reporting on the media worker.
- Windows reports `media-foundation` sessions, `NV12`/`P010` source formats and `native-video-dxgi` transfers. The shared handoff budget conservatively includes converted output and input-surface storage; opaque codec-reference allocations and the renderer atlas remain separate. Prepared coverage is still bounded, and a cold/evicted clip can take time to prepare.

The Windows compiler check covers the renderer and all Rust test targets. A dedicated non-publishing Windows CI workflow compiles/links the tests and runs pure Windows video policy tests. Runtime suites and the four-clip benchmark support both platforms and reject silent software fallback. A Windows-only test holds one texture while three other decoder queues advance, checking that pooled surfaces are not overwritten.

Local regression evidence: the Mac release rebuild passed; all 84 ordinary Rust tests passed (four opt-in hardware cases ignored), including 13 shared stream/memory lifecycle tests and validation of the actual Windows blit shader; the three hardware runtime suites passed 15 cases with the Windows-only case explicitly skipped. The updated benchmark also completed 32 prepared retriggers on the M1 Max with zero underflows, software frames, fallback or CPU video uploads. These results verify the shared implementation and Mac behavior, **not Windows playback speed or driver compatibility**. Consolidated evidence is in `reports/windows-hardware-video-local-validation-2026-09-18.json`.

**Physical Windows follow-up (`bb97237e`):** the RTX 4070 Laptop GPU, driver 32.0.16.1047, passed all 19 H.264 hardware scenarios, two HEVC Main10 full/limited-range cases and two transparency compatibility cases. Coverage includes first-picture colors, B-frame/VFR stepping, seeks, the mouse/MIDI scrub bridge, held textures, loops, four sources, 4K memory admission and scratch-history reclamation. The four-source benchmark completed 256 retriggers over eight seconds with 1,024 hardware frames and zero software frames, fallbacks, CPU video uploads or stream underflows; command acknowledgment p95 was 5.13 ms, **not controller-to-display latency**. Windows release build, Electron addons, frontend build, 33 control tests and 13 Rust video tests passed; desktop checks had zero errors and existing warnings. The development app reached a healthy D3D12/DXGI preview. See [the complete Windows validation report](../reports/windows-hardware-video-validation-2026-09-18.md).

The Windows fixes also handle per-sample interlace flags, Media Foundation trim timestamp rounding, missing output matrix metadata and explicitly described DXVA padding. Intel UHD was present but not the selected test adapter. AMD/Intel playback, packaged/signed-installer acceptance, physical controller/display latency, projector rigs, device-loss recovery and a long soak still need qualification using `docs/WINDOWS_HARDWARE_VIDEO_VALIDATION.md`.

### Native scrubbing and frame stepping follow-up (2026-09-18, shipped in 2.0.8)

**Available in the layer and VJ video controls:** dragging the playhead sends seeks directly to the native playback session. Supported hardware clips reuse their persistent decoder and GPU surfaces without launching one-shot FFmpeg previews. Rapid drag updates are coalesced, and cancelling a drag or changing the source prevents an older request from committing its position to the new source.

Previous/next-frame controls pause playback and select the adjacent actual source timestamp, including variable-frame-rate video. They start from the frame actually shown, clamp at the trim edges, and leave the decoder ready to resume after the selected frame. macOS uses compressed-sample cursors; Windows uses a bounded search through decoded presentation timestamps. The macOS checks also exposed and fixed an HEVC open-GOP seek issue that could omit a leading B-frame near a keyframe boundary.

The native session reports the displayed source time, frame duration, source frame rate, source duration and seek generation. Unknown metadata stays unavailable. A step is confirmed only after its generation has presented a frame; the ordinary state-sync echo does not repeat the step. The UI requires a prepared session with exact stepping support and reports when that is unavailable. Compatibility playback can still seek, but the UI does not claim exact frame stepping from an estimated frame rate.

Validation for this follow-up:

- Seven scrubber helper tests passed, including cancellation and source-change races, plus five keyboard-routing cases protecting focused timeline arrows without breaking learned shortcuts. The helper, broker and scene-sync regression run passed 83 tests; desktop type/Svelte checks found zero errors.
- The full Rust suite passed 87 tests, with five opt-in cases ignored in that run. Six standalone macOS hardware tests passed, including 696 adjacent-frame, trim-edge and continuation checks across H.264, HEVC and variable-frame-rate fixtures.
- The three hardware runtime suites passed 18 cases; the Windows-only case was explicitly skipped. New output checks cover eight rapid seeks ending on the requested frame, adjacent steps within a constant-rate trim, and genuine variable-rate source-timestamp stepping followed by resume. Supported hardware cases continue to reject CPU video-pixel uploads and silent software fallback.
- The macOS release build and Windows all-targets compiler check passed at this checkpoint. The later physical Windows run above also exercised frame stepping and scrubbing.
- The rebuilt Mac development app was checked with the user's Wire Circuit clip in mapping and VJ modes: forward/backward frame buttons, focused timeline arrows, paused dragging, and playing drag/release. A saved backup preserved the open project across the app restart. Mapping frame steps read 5.600 → 5.633 → 5.600 seconds; VJ forward steps read 6.333 → 6.366 seconds at the clip's 30 fps.

This functionality shipped in 2.0.8. The Mac and subsequent RTX 4070 tests establish frame selection and transport behavior on those machines, not zero latency for arbitrary compressed-video seeks or general show readiness. Signed-build acceptance, additional GPU qualification and longer performance testing remain open.

### Continuous mouse and MIDI scratching follow-up (2026-09-18, shipped in 2.0.8)

The scrubber now allows one seek to present a picture before submitting the latest pending drag position. Intermediate input positions are coalesced instead of cancelling every decoder result during sustained movement; mouse release can replace the unfinished request once with the final position. Cancellation, clip changes and newer transport actions revoke pending work.

Paused hardware scrubbing reuses the actual containing frame and contiguous successors from the decoded ring, plus a history of recently decoded frames. Available shared-budget headroom can expand that history up to 96 frames or 64 MiB per session, whichever is smaller; otherwise it keeps the existing small cache. Nearby forward targets can continue the decoder instead of restarting from a keyframe. Cache lookup respects source timestamps, VFR duration and trim/session identity. Resume and required memory pressure release the optional history and idle Windows GPU pool allocations before returning their reservation; a scratch cache must not block a later live clip. This does not preload an entire clip or remove the cost of uncached backward seeks in long-GOP footage.

Both timelines are MIDI-learn targets named **Scratch (hold frame)**. Use **Cmd/Ctrl+M → click the timeline → move an absolute knob/fader → Esc**. Values span the current trim range and hold playback paused until Play. Existing `position` mappings still follow an external running timeline; re-learn the timeline to get scratching. Dedicated paths are `map:media:scratch`, `vj:<layer>:video:scratch` and `vj-b:<layer>:video:scratch`. Rapid CC bursts keep the final value. Mapping and Deck B transport commands now use native play state, including silent clips with no browser video element.

Standard 7-bit MIDI CC provides 128 positions across the selected range; it cannot address every frame of a long clip. The existing absolute pitch-bend mapping supports 14-bit input. Physical MIDI controller qualification remains open.

Measured on the user’s 960×540, 30 fps Wire Circuit H.264 clip (8 seconds with only its opening keyframe), using the same real scrubber helper before and after native history changes: 480 input positions over 8 seconds, repeatedly moving 3→5→3 seconds. Observed presented timestamp changes increased from 78 to 235 (9.75→29.38 per second); each two-second reverse leg showed 60 frames after the change. The 95th-percentile gap between observed changes fell from 182.45 to 49.96 ms. The final requested position held the correct containing frame. This is renderer-status sampling, not physical input-to-display latency. The expanded cache reserved 63,515,664 optional bytes within the 128 MiB shared test cap, with no CPU pixel uploads, software fallback, one-shot decode, decoder errors or error toasts. Details: `reports/native-continuous-scratching-2026-09-18.json`.

Final Mac validation: **133 control/helper tests**, **96 Rust tests** (5 ignored), and **22 Mac GPU runtime tests** passed; one Windows-only DXGI runtime case was skipped on Mac and subsequently covered by the Windows run above. The release build and Windows all-targets compiler check passed. GPU checks include continuous forward/reverse output, correct final-frame hold, resume releasing optional history, new clip admission at unchanged and reduced memory caps, and preserving history when a new clip fits without reclamation. The Mac app was reopened with the saved Wire Circuit project; Mapping and VJ mouse drags, playing drag/release, and both MIDI Learn scratch labels were verified. Physical controller testing remains open.

## 4. Paused agents (phase 1)

Each ran in its own git worktree with its own ports. Stopped mid-task on 2026-09-18. Nothing is merged. Review each diff before merging; none has been run through `npm run check:desktop` or `npx vitest run` to completion.

| Work | Worktree / branch | State when stopped | Left to do |
|---|---|---|---|
| **Lock the LAN remote** (pairing token for the port 9001 WebSocket and its HTTP listener) | `.claude/worktrees/agent-a162380e72cc88d38` / `worktree-agent-a162380e72cc88d38` | Mostly written, about 575 lines: `server/pairing.cjs`, `server/ws-server.js`, `server/ws-server.d.ts`, `src/lib/remote/`, `electron/main.js`, `electron/mcp-server.cjs`, `electron/preload.cjs`, `src/App.svelte`, `src/lib/components/MobileApp.svelte`. It also touched `src/lib/stores/shaderLibrary.ts`, which looks unrelated and needs a look. | Finish verification: unpaired client refused, paired client can change opacity, token reset unpairs, QR still pairs in one scan. Checks and tests. |
| **Clip launching behaviour**: column beat snap, trigger styles (normal/toggle/piano), fader start, ignore column trigger, lock layer, autopilot, cue points, tempo nudge and resync | `.claude/worktrees/agent-adcf1bd5b1ad2ccd2` / `worktree-agent-adcf1bd5b1ad2ccd2` | About 800 lines across `vjClipLauncher.ts`, `layers.ts`, `VJModePanel.svelte`, `midiRouter.ts`, `oscBindings.ts`, `keyboardStore.ts`, `controlPaths.ts`, `autoEngine.ts`, `docs/osc.md`, plus new `launchClock.ts`, `vjLaunchRules.ts`, `LaunchTempoControls.svelte`, `VJClipCuePoints.svelte`, `VJClipLaunchOptions.svelte`. Stopped while wiring the deck grid (column queue state, layer lock, options button, cell badges). | Finish the grid UI, unit tests (random bag, column queue, trigger styles, lock), verification in the dev app, `layerPersistence.test.ts` for the new VJClip fields. |
| **MIDI controller lights** (APC40 mkII, APC mini mk2, Launchpad X / Mini mk3, plus learned-pad feedback for any controller) | `.claude/worktrees/agent-aafe30a26511adf01` / `worktree-agent-aafe30a26511adf01` | Research only, no code written. | Start over from the brief in the appendix. |

Merge notes: the paused clip-behaviour work and the current layer transitions work both change the trigger path in `vjClipLauncher.ts` (`immediateTriggerClip`). The earlier agent was asked to keep its changes in small helpers so the two merge cleanly. Review the paused diff against the current launcher before resuming it. Worktrees need `node_modules` and the core binary symlinked from the main checkout.

---

## 5. Outstanding and known issues

In priority order.

1. **Next: Phase 2 video/media features.** LAN pairing is implemented with real-socket acceptance tests; phone/packaged acceptance remains. Controller feedback is implemented locally with hardware acceptance outstanding. Tempo nudge/resync and per-clip Fader Start/Ignore Column Trigger overrides are implemented locally. Column beat snapping, Normal/Toggle/Piano and the layer launch options are implemented locally. Autopilot is implemented locally with transitions, quantization, protection and Piano ownership checks. Eight persisted, MIDI/keyboard-learnable video cue points are implemented locally. Layer/clip transitions are implemented and Mac-verified locally; Windows runtime and packaged-build acceptance remain before release.
2. **Packaged-build playback acceptance.** Startup, green-first-pass, mapping in-point and loop fixes shipped in 2.0.8 and passed development/core checks. Repeat the live scenarios in the signed installed builds; publication alone does not qualify them. The earlier YUV explanation was a hypothesis; confirmed faults included discarded prepared decoders and placeholder fills before decoded textures existed.
3. **Broader hardware and show qualification.** Mac M1 Max and Windows RTX 4070 results are recorded in section 3. AMD/Intel, more Mac/GPU models, physical MIDI-to-display latency, projector rigs, device-loss recovery and a multi-hour soak remain open. Full-resolution 4K composition/output is not established by the atlas-scaled decode benchmarks.
4. **Compatibility-path trimmed loops** still relaunch FFmpeg every pass (with a full pass of head start). A very short trim can still stall if a launch is slow. Supported hardware loops retain their decoder and opening cache; this limitation does not describe that path.
5. **Compatibility-path FFmpeg launch time.** In dev the unsigned `ffmpeg-static` binary is checked by `syspolicyd` (first launch 0.4 to 3 s). Measure the signed packaged path for unsupported formats. Supported hardware playback does not launch FFmpeg.
6. **Remaining Windows checks:** the 2.0.7 preview-alignment fix on a scaled display and the `source_fps` expression with the packaged Windows compatibility decoder were not explicitly qualified by the RTX 4070 hardware pass.
7. **Behaviour change to watch:** layers with an old warped mesh now show it in Corner mode too. Reset Mesh clears it.
8. **Suggested follow-ups already written up as tasks:**
   - **Fixed locally, Mac process tests passed:** render core now exits when the owner command pipe closes, including abrupt broker death. Windows runtime acceptance remains.
   - Every Screen bound to a VJ row renders its own copy of the row (its own shader or crossfade graph) instead of sampling the one feed frame: an N-times GPU cost in STAGE mode.
   - Native core timing tests still use fixed sleeps and are flaky under load.
9. **Carried over from earlier, status unclear:** a downloads-page section on 2.0 vs 1.9 system requirements, and moving the logo and content up under the stage on mobile. The mobile hero ground was made seamless (ghostarcade-web `2de5bb2`) and the stage zoom removed on phones (ghostarcade-web `437ba69`), but the requirements section and the logo shift were not confirmed done.
10. **Housekeeping.** `reports/` contains committed native validation summaries alongside untracked local diagnostics, particle bench stills and an unrelated brief; stage only specific relevant evidence files. The older worktrees and saved test project remain separate; inspect actual process state before restarting development apps.

---

## 6. Resolume parity plan: everything left

Originally based on Resolume Avenue and Arena 7.26 (manual plus the 7.24, 7.25 and 7.26 release notes) against the 2.0.7 source; implementation status is now refreshed against **2.0.8**. Original size estimates assume one developer with an AI coding assistant: **S** a few days, **M** one to two weeks, **L** three weeks or more. The phases are ordered; each builds on the last.

### Where Ghost Arcade already leads (protect these)

- AI control that works live: MCP server plus the Director agent. Resolume added MCP in 7.26, but it only builds compositions and can't touch slices, mappings or presets.
- Generative content: 309 ISF shaders, 11 native particle, fluid and smoke instruments, gaussian splats, 3D models, three.js and p5.js.
- Stage Sim (3D venues) and Map Sim (projection onto 3D objects).
- Stage Designer with 17 Screen FX chases, hand-tracking control, SynthVision, the mobile app, WLED output.
- Free and open source; Arena is €799.

### Phase 1: play a whole set without workarounds (about 6 to 8 weeks)

| Item | Size | Status | Done when |
|---|---|---|---|
| Effect chains with no silent limit | M | **Shipped in 2.0.8**; 12/16-pass native output tests pass | Up to 16 enabled effects render; the 17th shows a warning while the first 16 remain active |
| Layer and clip transitions (0 to 10 s, style per layer, per-clip override) | M | **Implemented locally, Mac verified** on `codex/clip-transitions`; Windows runtime acceptance remains | A new clip on a layer set to a 1 s dissolve fades in with no black frame |
| Trigger behaviour: beat snap for columns, trigger styles, fader start, ignore column trigger, lock layer | S | **Implemented locally**, including per-clip inherit/on/off overrides; Mac controls checked | A column fired mid-bar lands on the next bar; a piano pad plays only while held |
| MIDI feedback to controllers | M | **Implemented locally** for four profiles and learned VJ pads; simulated Web MIDI checks pass, physical controllers unqualified | An APC40 grid mirrors deck A; a queued clip blinks until it fires |
| Autopilot and cue points | M | **Autopilot and eight video cue points implemented locally, Mac UI checked**; physical latency/Windows acceptance remains | Random bag plays each clip once per cycle; a cue pad jumps within one frame |
| Tempo nudge and phrase resync | S | **Implemented locally**; shared-clock, queue, pause and Link ownership tests pass | Resync on a phrase start realigns every BPM-locked clip and LFO |
| Lock the LAN remote | S | **Implemented locally**, real-socket tests and Mac/unpaired-browser checks pass; physical phone/packaged acceptance remains | An unpaired device on the same network can't read or change the show |

**Effect chain implementation.** `nativeEffectChainPolicy.ts` shares the 16-pass cap and overflow wording across the sync layer, Canvas and effects panels. The core already reuses two intermediate textures. Overflow is a warning, not a layer-pending error that would block the supported chain. Per-pass cost still scales with chain length.

**Transitions implementation.** `vjClipTransitionNative.ts` uses the ten crossfade formulas with per-input geometry and premultiplied coverage. Stable canonical row carriers also remain after a fade, so VJ Mix and mapped Screens do not jump to an untransformed raw input at completion. `vjClipTransitions.ts` retains outgoing clips; `nativeClipTransitionCoordinator.ts` gates the clock on native readiness and coordinates GPU snapshots for interrupted fades. The core orders nested graphs and effects by dependencies, tracks completed frame generations, and refuses to evict live sources when capacity is full. This required additional ordering/readiness work beyond the older crossfade pipeline warm-up.

### Phase 2: video that holds up at 4K (about 8 to 10 weeks)

| Item | Size | Status | Done when |
|---|---|---|---|
| Hardware decode (VideoToolbox, Media Foundation/D3D11VA), frames kept on the GPU | L | **Shipped in 2.0.8**; tested on Mac M1 Max and Windows RTX 4070. Other vendors, packaged builds, full-resolution 4K composition and physical latency remain unqualified | Four native-resolution 4K clips at source rate with bounded memory, no CPU pixel uploads, and measured input-to-display latency on supported GPUs |
| HAP, HAP Alpha, HAP Q as compressed GPU textures | L | **Implemented locally; qualification partial.** Indexed MOV samples, Snappy/chunk decoding, BC1/BC3 GPU upload and HAP Q shader reconstruction. Mac GPU golden tests cover all three formats, alpha, warm claim, seek and exact stepping. Sixteen 1080p60 HAP streams reached 59.94 compositor fps on M1 Max; HAP Alpha reached 59.49 fps and HAP Q 59.99 fps with a 1 GiB decode budget. Windows compile checked; packaged playback and long-set qualification remain open | 16 simultaneous 1080p HAP clips at 60 fps; HAP Alpha edges composite correctly |
| Native resolution, native frame rate, more streams | M | **Partly shipped in 2.0.8:** coded-resolution hardware decode and source timestamps, native scrubbing, exact adjacent-frame/VFR stepping and continuous mouse/MIDI scratching tested on Mac M1 Max and Windows RTX 4070. GPU scales into the configured atlas; the local ceiling is now 16 playing streams under the shared memory budget. Full-resolution 4K composition and beat-locked transport remain open | A 25 fps clip plays at 25 fps, frame-accurate against the BPM-locked playhead |
| Reverse, bounce, and a playhead locked to the beat | M | Partial — native reverse, bounce and hardware beat-phase following implemented locally; external Link endurance acceptance open | Reverse HAP/native transport, trim-out launch, retained openings, exact steps, VJ controls and persistence tested on Mac. Sixteen reverse HAP streams measured 59.92 fps, and final HAP Alpha/Q measured 59.93 fps after fixing delayed GPU retries; 256 four-clip H.264 reverse retriggers have zero underflows after opening retention. Four 960×540 long-GOP clips also sustained approximately 30 fps each without underflows after extending the presentation queue; broader codec/load and Windows runtime qualification remain open. See `reports/native-reverse-validation-2026-09-18.md`. Bounce now shares VJ/Mapping controls, preserves pause direction and saved settings, and counts full round trips for Autopilot. Mac GPU/UI tests passed; 16 HAP Alpha clips measured 60.00 fps without dropped frames or underflows, and four H.264 clips sustained ~30 fps each without underflows. See `reports/native-bounce-validation-2026-09-18.md`. Beat-lock acceptance remains: a 4-beat loop stays on the bar for 10 minutes against Ableton Link |
| Media workflow: image sequences as clips, converter writing HAP / HAP Q / ProRes, media manager (relink, collect) | M | **Converter and media manager implemented locally:** HAP, HAP Alpha, HAP Q, ProRes 422 HQ/4444 and H.264 from videos or PNG/JPG sequences; local-file inventory, explicit relinking and portable collection. Mac desktop conversion, collect/move/reopen and relinking passed. Direct sequence clips removed from scope at Justin’s request; external model dependency collection and Windows packaged acceptance remain open | A project moved to another machine opens with every clip found or listed for relinking |
| Clip audio: on by default, volume and pan per clip and layer, output device choice, driven by the core clock | M | Implemented for native VJ playback; acceptance ongoing | Mac native output tested through pause, seek/resume, speed, reverse/bounce and pan; Windows compilation passes, physical Windows playback still needs testing. See `reports/native-clip-audio-2026-09-19.md`. |

The shipped hardware playback, bounded opening/history caches, seamless loops and direct timeline controls (section 3) are a substantial part of this phase; they do not complete its 4K, codec, reverse or audio goals.

**HAP acceptance (local, September 18):** the renderer reads indexed MOV samples directly and retains BC-compressed pixels through upload. Snappy decompression runs on the media worker; texture sampling and HAP Q color reconstruction run on the GPU. Playback uses no FFmpeg process or CPU RGBA expansion for supported HAP files. Three real Metal output tests compare HAP, HAP Alpha and HAP Q against independent decoded reference pixels, including transparent, translucent and opaque regions, warm preparation, seek and repeated exact frame steps. Six real MOV variants cover uncompressed/Snappy packets; parser/chunk bounds and shader validation are tested. Existing hardware-video playback regression checks pass. The Mac app imports a HAP Alpha MOV with thumbnail, duration and a working mouse/keyboard timeline. Browser-unsupported formats use a bounded native thumbnail probe at import time. Unsupported MOV edits/transforms and other HAP variants use the compatibility path. The six-prepared/sixteen-playing pool remains bounded, with three buffered frames per HAP session. Short 16-stream HAP/HAP Alpha/HAP Q throughput checks pass on M1 Max at approximately 60 fps, using a 1 GiB decode budget and 512-pixel atlas slots; this is not full-resolution multilayer 4K composition. Windows runtime, storage/thermal soak and physical latency remain open. See [HAP validation and limitations](../reports/native-hap-validation-2026-09-18.md).

**Converter acceptance (local, September 18):** thirteen real bundled-FFmpeg tests cover all six output formats, alpha retention from raw RGBA and VP8/VP9 WebM, exact sequence frame counts at 24/60/59.94 fps, cancellation cleanup and refusing existing/racing output files. Transparent WebM inputs use libvpx decoding to retain the separate alpha plane. Output is staged beside the destination and only published after successful encoding; existing files are never overwritten. Mac desktop conversion produced a 25-frame HAP Alpha MOV through the normal File → Video Converter workflow. Compressed-texture playback is implemented separately as described above. Converter acceptance does not qualify playback throughput or Windows packaged encoders.

**Project media acceptance (local, September 18):** File → Project Media scans durable file references and legacy paths across the exported project, shows missing files and replaces all uses of a selected reference. Relinking reloads the project, interrupts playback and requires Save to persist. Collect writes a separate `.gha` plus a sibling `Media-*` folder with relative paths, deduplicates shared sources and refuses an existing destination or missing media. Normal Save still does not copy media. Eight filesystem tests cover move/reopen, relinking, duplicate references, foreign paths, missing/session-only media and refusing uncollected dependencies. The Mac UI collected four sources, reopened them from a moved folder, detected a renamed source and repaired both uses. Remote/live sources require their connections; embedded media stays embedded. External GLTF/OBJ/playlist dependencies are explicitly rejected by Collect rather than advertised as portable.

### Phase 3: Arena-grade stage I/O (about 10 to 12 weeks)

| Item | Size | Status | Done when |
|---|---|---|---|
| More than 8 screens (`MAX_SLICE_OUTPUTS`), native screen windows and deck monitors on Windows | L | **Screen capacity implemented locally:** up to 32 open core outputs within 512 MiB; Mac shared-texture GPU acceptance passed. Direct Windows screen/deck windows remain open | Windows drives 5 projectors plus a UI monitor from the core with no editor relay |
| Bezier warp and per-screen polygon masks | M | Not started | A curved cyclorama maps with a 4x4 bezier grid where bilinear needed 12x12 |
| DMX / Art-Net / sACN pixel-mapping output with a fixture editor, auto-spanning universes, ArtSync; DMX input from lighting desks | L | Not started | A 170-pixel strip across two universes follows the output; a desk fader drives layer opacity |
| Timecode and DJ sync: SMPTE LTC (and MTC) with per-clip offsets, Pioneer Pro DJ Link, Denon StageLinQ | L | Not started | A clip at 01:00:00:00 chases LTC with no drift over 5 minutes |
| NDI in and out in every release build, macOS and Windows | M | Not started | The downloadable build sends 1080p60 NDI to OBS on both platforms |
| 10-bit output and a 16-bit composition path; Blackmagic DeckLink input and SDI output | L | Not started | No banding on a slow gradient on a 10-bit display; SDI reaches a DeckLink monitor |

### Phase 4: open the platform and deepen the controls (about 8 to 10 weeks)

| Item | Size | Status | Done when |
|---|---|---|---|
| REST and WebSocket API, token-authenticated, on the same tool layer as the MCP server, with parameter subscriptions and output snapshots | L | Not started (depends on the LAN lock) | A script lists layers, triggers a clip and subscribes to opacity; docs generated from the same schema |
| Dashboard dials for any parameter (several per dial, ranges, invert) per clip, layer and composition; macro knobs render every effect natively, not only 9 colour operations | M | Not started | One dial drives blur and hue together, with MIDI, in the native output |
| Envelopes with easing (sine, exponential, elastic, bounce, hold); crossfader position and clip position as animation sources | M | Not started | A BPM-synced opacity pulse with exponential decay saves as a preset and reuses |
| Groups in VJ mode: a real group compositing pass with group effects, master, blend and column trigger, routable to screens | L | Not started | A blur on a group blurs the combined picture, not each layer separately |
| ISF completeness: multi-pass (`PASSINDEX`, persistent buffers) and live audio/FFT inputs | M | Not started | A multi-pass feedback shader and an audio-spectrum ISF from the public corpus render correctly |
| Recording and polish: record individual layers or screens, render clips with alpha (HAP Alpha or ProRes 4444), user effect-chain presets, `.cube` LUTs, expressions in number fields | M | Not started | A generator renders to ProRes 4444 with a clean alpha channel |

### Not building

- **DXV.** Proprietary; HAP does the same job in the open.
- **A Wire-style node editor.** Ghost Arcade's answer is AI shader authoring plus ISF and native instruments.
- **FFGL and VST hosting.** FFGL plugins are OpenGL and the core is WGSL; hosting them is a rewrite.
- **Multi-computer frame sync.** Resolume doesn't solve it either; revisit after the API ships.

### Decisions needed

- **NDI:** can the NDI runtime ship inside AGPL installers, or must users install it?
- **Pro DJ Link:** the protocol is unofficial and could break with Pioneer firmware. Worth the risk?
- **Phase order:** the playback milestone shipped in 2.0.8. Layer/clip transitions are now implemented and Mac-verified locally. Continue phase 1 with trigger behaviour while preserving playback responsiveness and tracking Windows transition acceptance and remaining hardware qualification separately.
- **1.9 line:** none of this goes to 1.9; it stays a fixes-only fallback.

---

## 7. Working notes

- **Dev boot, isolated:** `GA_USER_DATA_DIR=<scratch dir> VITE_DEV_SERVER_URL=http://localhost:1420 npx electron . --remote-debugging-port=9234`. Never kill `/Applications/Ghost-Arcade.app`. Processes launched from the agent shell inherit nice 5, which slows ffmpeg; the installed app runs at normal priority.
- **Store access over CDP:** after hot reloads the app imports stores with a `?t=` query. Import the exact URL the app uses (read it from a transformed importer) or you get a second store instance.
- **Output readback:** `native_renderer_get_output_shared_texture_snapshot` reads what was actually presented; `native_renderer_get_frame_snapshot` re-composites between frames. Hammering either at full rate perturbs playback; sample at 15 to 20 Hz.
- **Checks:** `npm run check:desktop` (0 errors), `npx vitest run`, `npx vitest run --config vitest.native.config.ts`, `cargo test --release` in `native-renderer/`.
- **Releases:** push the branch and an annotated `vX.Y.Z` tag; CI builds, signs, notarizes and uploads to `ghost-arcade-releases` with notes from `docs/releases/vX.Y.Z.md`. Then bump `V2_VERSION` (2.x) or `RELEASE_VERSION` (1.9 only) in `ghostarcade-web/src/lib/release.ts` and push `main`. After any 1.9 release, re-mark the current 2.x release as Latest.
- **Commit identity:** justin@dreamscience.art.

---

## Local update: eight video cue points

Every video transport panel now has eight numbered cue pads. Click an empty pad to save the current transport position, click a saved pad to jump, Shift-click to replace, or use its clear button. Cue positions are stored in source seconds and persist on both decks, including when the playing video belongs to a different browsed block. Missing/invalid slots are sanitized on import. For exact frame placement, pause and use the existing source-frame stepping controls before saving a cue.

Jumps submit directly to native playback without waiting for a UI animation frame or beat quantization. They preserve play/pause state, clamp inside the trim range (exclusive out point), share monotonically increasing seek generations with scrubbing, and revoke older mouse/MIDI scratch work. Cue edits do not reset Autopilot; jumping invalidates any queued automatic follow action from the old position. Cues remain transport controls on locked layers and preserve Piano release ownership.

Cue pads support MIDI/keyboard learning. Shared control paths also expose cue press, explicit set and clear for custom OSC/keyboard/MIDI bindings; see [OSC cue controls](osc.md#video-cue-pads). Rapid MIDI cue presses bypass continuous-control throttling, and note-off is ignored even when a mapping has a nonzero minimum.

Validation: 147 targeted tests pass across cue persistence/routing, native seek submission, scrubbing, Autopilot, launch modes, transitions and beat clock. Desktop checks report zero errors with existing warnings; the production build passes. Mac development UI verified saving 4.929 seconds, moving playback elsewhere, jumping back while remaining paused, and clearing the slot. This confirms control behavior; source-frame landing and input-to-picture latency still require physical Windows/codec acceptance. Inter-frame media can require decoding from an earlier keyframe, so arbitrary cue jumps are not a measured zero-latency guarantee.

## Local update: per-clip Autopilot

The Clip tab now offers Off, Next, Previous, First, Last, Random, Random Other, Random Bag and Specific Column follow actions. Choose a positive beat count or, for seekable video, a loop count. Empty cells and clips incompatible with the current mixer mode are skipped; Next/Previous wrap. Random Bag visits each eligible clip identity before repeating, avoiding immediate repeats at cycle boundaries. Settings persist independently on both decks. Every clip in a continuous chain needs its own follow action; an Off destination stops the chain.

Autopilot uses the normal launch/transition path and QUANT setting while bypassing pad Toggle/Piano semantics for automatic destinations. Manual pending launches and held Piano inputs take priority. Locks pause counting, Ignore Column Trigger does not suppress independent follow actions, and Stop All/exit disable the scheduler. A clip left playing from another block cannot jump into unrelated content in the block being browsed. Mirrored output and simulator windows never run their own scheduler.

Beat counts integrate the current launch-clock tempo (Link, manual, detected, fallback). Video loops count transport time over the trim range, honoring playback speed and pauses; they are not decoder-reported frame or loop counters. Enabling loop mode partway through a clip starts from its current transport position. A seek, trim edit, manual retrigger or changed follow rule starts a new count. Play Once can complete only one pass. Missing duration or static/live content cannot produce video-loop counts. A queued automatic action is invalidated when its source changes, is paused/seeks, or Autopilot is disabled. A canceled follow action does not repeatedly requeue itself. Retrigger the clip or edit its rule to begin a fresh run where needed.

Validation: 123 targeted tests pass across the clock/selection rules, store/persistence, keyboard, MIDI, OSC, transitions and beat clock. Tests cover both decks, chaining, tempo/rate changes, pause/resume, trimmed loops, random bags, queued cancellation, protection and receiver-window exclusion. Desktop checking reports zero errors with existing warnings, and the frontend production build passes. Mac development UI verified Red advancing to Blue after a four-beat follow setting. Decoder stalls, long-run performance and physical Windows/controller timing remain acceptance work; transport-clock tests do not establish rendered-frame accuracy.

## Local update: Ignore Column Trigger and Layer Lock

The Layer tab has independent Ignore Column Trigger and Layer Lock switches for both decks, saved with the project and defaulting off for legacy files. Row indicators show a dot for column ignore or a lock icon for locked content.

Ignore Column Trigger skips both clip launches and empty-cell clearing on that row. Individual clip launches and Piano releases remain available. Queued columns capture their participating rows. Protecting a row removes it from an existing queue; unprotecting it before the beat cannot revive the canceled launch. Editing excluded cells does not invalidate other rows' queued launches. Individual queued clips and Piano holds on an ignored row survive column launches.

Layer Lock blocks pad/retrigger, forced, transient and column launches, individual layer Stop, active-cell replacement/clearing and removal of the locked row. Locking cancels that row's pending clip launch and sustains any currently held Piano clip after its release. Faders, effects, video transport and Fader Start remain available. Stop All deliberately overrides every lock; project reset and teardown also remain available. The behavior follows [Resolume's content-lock model](https://www.resolume.com/support/en/layers), with the explicit emergency-stop override above. Per-clip inherit/on/off overrides are now implemented; see the local update below.

Validation: 95 targeted tests pass across launch/persistence, keyboard, MIDI, OSC, transitions and beat clock. Desktop checks report zero errors with existing warnings, and the production build passes. Mac UI verified a protected Red row surviving a Blue column launch, a blocked manual replacement, the disabled layer Stop button and Stop All clearing both rows. Windows and physical controller acceptance remain open.

## Local update: layer Fader Start

The Layer tab now has a Fader Start switch, saved independently for every row on decks A and B, defaulting off for legacy projects. Raising layer opacity from exactly zero restarts the current video at trim-in and resumes playback. Movement above zero does not retrigger. Lowering to zero hides the clip without unloading it. This follows the restart-on-fade-up behavior in [Resolume's clip documentation](https://resolume.com/support/en/7/clips).

Opacity and the fresh native seek generation publish in one store update; an urgent native handoff follows before browser transport work. Restart uses the actual active clip, even after navigating to a different block. It bypasses launch quantization while retaining queued launches and Piano ownership, and does not reset the global keyframe timeline. Stop All leaves nothing to restart. MIDI opacity events preserve zero crossings even inside a rapid message burst.

Scope: this layer option restarts seekable video transport. Static images, live inputs and procedural generators retain their existing behavior. Per-clip inherit/on/off overrides are now implemented.

Validation: targeted store/persistence, controller routing, keyboard, OSC, transitions and beat-clock suites pass. Desktop checking reports zero errors with existing warnings and the production build passes. In the Mac development app, a video paused at 4.229 seconds restarted and resumed when the layer rose from 0 to 0.01; the first UI observation showed 0.350 seconds. This verifies behavior, not measured latency. Physical MIDI and Windows acceptance remain open.

## Local update: Normal, Toggle and Piano clip triggers

Per-clip Trigger controls offer Normal (restart), Toggle (start/stop), and Piano (hold to play). Legacy projects default to Normal. Settings persist on both decks. The selected clip's mode remains editable after it stops.

Piano supports mouse/touch press and release, focused-cell Enter/Space, learned keyboard bindings, MIDI note/CC release and OSC zero values. MIDI note-off bypasses event throttling and mapped minimum values. Multiple inputs can hold one clip; the last release stops it. Release before a quantized launch cancels it. An old release cannot stop a replacement clip or a later column/forced launch. Columns deliberately launch continuously regardless of individual clip modes. Fire-only callers without a release identity retain ordinary launch behavior.

Mouse cancellation/window blur, keyboard blur/disarm, selected MIDI device detachment and OSC listener shutdown release their owned holds. OSC senders must send zero on release; UDP sender disappearance cannot be detected reliably. No timeout is imposed on a held performance pad.

Validation: 75 targeted store, persistence, keyboard, MIDI routing, OSC, transition and beat-clock tests pass. Desktop type checking reports zero errors with existing warnings; the production frontend build passes. Mac development UI verified the selector, Toggle start/stop and a complete Piano accessibility tap. Physical MIDI/OSC hardware timing and Windows runtime acceptance remain open.

## Appendix: agent briefs (condensed, for restarting)

**Lock the LAN remote.** Generate a random pairing token per install, persisted and resettable (reset unpairs everything). Show it in the Connect Mobile popup and embed it in the QR URL so pairing stays one scan. Reject WebSocket upgrades and HTTP requests without a valid token (constant-time compare); the desktop app's own connection presents it too. The phone remembers its token and explains a rejection plainly. Consider sharing a token source with `electron/mcp-server.cjs` without changing its bind address. Keep the 10 MB `maxPayload`. Verify with a Node `ws` client with and without the token.

**Clip launching behaviour.** In `vjClipLauncher.ts` and `VJModePanel.svelte`, with triggers also arriving from MIDI, OSC and the keyboard:
- Column triggers follow quantization, and a second click cancels a queued column.
- Per-clip trigger styles: Normal, Toggle, Piano (release path for mouse, MIDI note-off, key-up, OSC 0).
- Per-layer options: Fader Start, Ignore Column Trigger, Lock.
- Per-layer autopilot (independent on Deck A and Deck B): after N loops or N beats go to next, previous, random, random other, random bag, first, last, a specific column, or nothing; always through the normal trigger path.
- Up to 8 MIDI-learnable cue points per video clip.
- Hold-to-nudge tempo, and a Resync that makes now the downbeat (disabled with a tooltip while following Ableton Link).
- Persist everything with the project, and keep the trigger-path changes in small helpers so layer transitions can merge alongside.

**MIDI controller lights.** Open outputs through the same Web MIDI access, auto-paired to the input by name. Profiles for APC40 mkII, APC mini mk2, Launchpad X and Launchpad Mini mk3, with note maps, palettes, channels and SysEx taken from the manufacturers' protocol documents and cited. Show the selected deck's current block on the grid: off for empty, dim for loaded, bright for playing, blinking for queued, with deck A and B in different hues and paging when the grid is wider than the device. Also light learned pads (clip triggers and toggles) on any controller. Send only changes, batched per frame, and clear on close. Add a Controller lights block in Settings > MIDI. Verify with a fake Web MIDI device injected before load.


## Local update: shared tempo clock and clip launch overrides

Hold NUDGE −/+ to bend the local tempo by 4%; releasing returns to the set BPM and retains the phase gained. Mouse, keyboard and MIDI/OSC inputs have independent ownership, with cleanup on release, blur, disconnect or closing the mixer. Resync establishes a new downbeat, restarts BPM-synced video at trim-in while preserving pause, realigns synced LFO phase, resets Autopilot counting and rearms queued launches. Free-running LFOs are unchanged. Local controls are disabled while a connected Ableton Link session owns tempo and phase. Quantized launches retain a target beat and adjust their wall-clock deadline as tempo changes.

Clip settings now offer Use layer / On / Off for Fader Start and Ignore Column Trigger. Column protection applies to the currently playing clip, including empty destination columns. Explicit Off overrides the layer default. Enabling protection removes participation from an already queued column; turning it off does not revive that launch. Manual clip launches remain available. These settings persist on both decks, and legacy clips inherit the layer. The behavior is based on [Resolume's clip launch documentation](https://resolume.com/support/en/7/clips).

Validation covers continuous phase through tempo changes, nudge ownership/release, Link exclusion, queued tempo changes, paused video resync on both decks, LFO phase, clip overrides, queued protection and persistence. Mac UI exposes the new tempo controls and clip selectors; the clip protection selector was exercised. Physical controller timing, beat-to-picture latency, Windows runtime and long-run synchronization remain acceptance work. These clock changes do not claim a frame-locked video transport or eliminate codec seek latency.


## Local update: controller lights

Settings → MIDI now includes controller output/profile selection, deck selection, paging and grid launching. APC40 mkII, APC mini mk2, Launchpad X and Launchpad Mini mk3 profiles use manufacturer protocol messages. Feedback distinguishes loaded, playing and queued clips and follows block/deck changes. Learned VJ note controls take priority over built-in grid input and can also receive feedback. Outputs are independent of MIDI Clock, auto-pair only on an unambiguous name match, send changed LEDs per frame and clear on normal teardown. Piano releases retain the address from the original press across paging or deck changes.

See [controller setup, protocol sources and acceptance limits](midi-controller-lights.md). Simulated Web MIDI and pure feedback tests pass; no physical controller or Windows controller qualification is claimed. Generic feedback covers learned clip triggers and selected VJ state controls, not every arbitrary effect toggle. App-session opt-in is required for device-mode setup.


## Local update: LAN pairing

The reviewed pairing work is integrated into this branch. Connect Mobile shows a persistent per-install code and embeds it in the QR URL; phones remember the code and explain an authentication rejection. Both HTTP and WebSocket listeners require authentication, including desktop shader-library requests. Reset revokes existing connections and old credentials. MCP keeps its own token and loopback binding.

Additional review fixes prevent cookie-only HTTP mutations, reject malformed/escaping asset paths, preserve revocation if saving a replacement code fails, avoid logging desktop credentials from fallback children, and remove the startup sweep that could kill another live application's listener. Isolated server tests bind only to loopback. [Pairing behavior and acceptance limits](remote-pairing.md) records the remaining physical-phone, packaged-build and network checks. Authentication is not TLS; use a trusted local network.

### Layer Autopilot correction

Autopilot now belongs to the Layer tab, above launch protection and transitions. One rule advances continuously through the current layer’s clips, without configuring each clip. Each deck stores independent layer rules. Clip-level Autopilot UI is removed; legacy clip rules no longer drive playback. Select an action and beats or video loops, then launch a clip to start. Empty cells are skipped and launches respect quantization, layer locks and held Piano controls. Layer rules survive project save/import. Validated with 110 store/clock tests and the running Mac UI.

### Layer strip settings placement

Layer FX now contains effects only. Each mixer layer strip has a direct lock button, an A Autopilot toggle, and a gear tray for Autopilot rules, Ignore Column Trigger, Fader Start and transitions. A preserves its configured rule while disabled; first enable defaults to Next clip every four beats. MIDI Learn exposes `vj:<layer>:autopilot` and `vj-b:<layer>:autopilot`. Layer pause state persists. The tray uses a native dismissible popover with viewport-constrained scrolling.

### Native owner lifetime

The renderer now sends an owner-disconnected event when its command pipe reaches EOF or a terminal read failure, then exits through the same event-loop path as explicit shutdown. Mac release-build process tests verify clean exit on pipe closure and renderer termination after forcibly killing an isolated test broker. Native unit suite: 107 passed, 6 ignored. Run `npm run native:owner-lifetime` to repeat. This addresses owner loss; GPU/device hangs and Windows runtime qualification remain separate checks.

### Video tempo-fit precision

Removed the 0.001 playback-rate deadband: fractional tempo changes now apply with 1e-9 tolerance while preserving the transport position. A shared beat-fit calculation handles trim, reverse and full bounce cycles, rejects unknown durations, and reports speed clamping. The VJ transport warns when the requested beat length exceeds 0.05–8× playback, showing the attainable cycle length. Tests cover fine tempo changes without playhead jumps, both rate limits and ten-minute ideal-clock arithmetic; this is not a real-time Ableton Link phase-lock or hardware soak acceptance. Phase correction against Link remains open.

### Hardware tempo retiming

Same-direction hardware playback-rate changes now retime the consumer presentation clock while preserving its current position, queued frames and decoder worker. This removes decoder replacement from ordinary tempo/nudge updates. Content/range changes, explicit seek changes, direction changes outside bounce, and compatibility/software playback retain the existing replacement paths. This is a prerequisite for smooth phase correction, not completion of the ten-minute Link phase-lock acceptance. Runtime validation is recorded separately in `reports/native-tempo-retiming-2026-09-19.md`.

### Hardware beat-phase following (September 19)

VJ hardware loop and bounce clips with a beat length now receive runtime-only phase targets from the shared clock every 100 ms. Both decks use independent phase anchors. The renderer compares these targets with its continuous stream clock and applies a bounded ±4% speed correction, without seeking, replacing the decoder, or writing project state. Pauses, cue/scrub generations and retriggers reset phase anchors; stale corrections expire after 500 ms. One-shot playback, unsupported/software paths and speed-limited beat fits retain tempo fitting without phase correction. Selecting Free disables phase following.

A subsequent ten-minute Mac native soak with a real Ableton Live Link peer passed for forward, reverse and bounce, including 88/92/98 BPM changes. The native clock p95 errors were below 2 ms; these are not displayed-frame or audio-loopback measurements. End-to-end visible-output timing and Windows runtime acceptance remain open. See `reports/ableton-connection-validation-2026-09-19.md`. See `reports/native-beat-phase-2026-09-19.md` for validation and limits.


### Native screen capacity (September 19)

Raised the native simultaneous screen-output ceiling from 8 to 32 while retaining the 512 MiB render/export texture budget. Configuration validation rejects duplicate or missing IDs, malformed lists, too many outputs and excess texture memory before replacing existing outputs. Batched commands now report screen errors instead of silently counting rejected updates as applied. The Screens panel displays the rejection and explains that previous outputs remain active; successful updates clear it.

Validation: Rust admission checks include 32×1080p and 8×4K within budget, 33 outputs and 9×4K rejected. A real Mac Metal test rendered 32 separate 64×64 shared-texture outputs, verified rejected count/memory/duplicate changes preserved them, and checked removal down to two and zero outputs. These are capacity/lifecycle checks, not 32 full-resolution projector performance qualification. Renderer sync tests: 62 passed. Desktop checking: zero errors, 1038 existing warnings. Mac release build and Windows cross-compilation passed. Direct Windows screen/deck output windows and visual rejection-banner acceptance remain open.

Prism Tide is saved at `scratchpad/ableton-link/Prism Tide Project/Prism Tide - Performance.als` for later OSC testing. Keep the surrounding project folder and Samples/Imported files together.
