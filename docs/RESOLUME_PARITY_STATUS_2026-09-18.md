# Resolume parity: status, outstanding work and the full plan

Written 2026-09-18. Covers the work from the 2.0.6 release through the start of
the Resolume parity build, what is left open, and every remaining item of the
four-phase plan to reach Resolume Avenue/Arena level.

The comparison page behind the plan (filterable feature table, private
artifact): https://claude.ai/artifact/CAAf6CVKBLRdAGnsHx5ErC

---

## 1. Where things stand

| | State |
|---|---|
| Latest 2.x release | **2.0.7**, tagged `v2.0.7` on `codex/native-main-driver-wip`, signed and notarized, live on ghostarcade.live |
| Latest 1.9 (legacy) release | **1.9.995**, tagged `v1.9.995` on `hotfix/1.9.995`, signed and notarized, live as the legacy download |
| Uncommitted in the main checkout | Native macOS/Windows hardware playback and prepared-frame cache, direct native scrubbing and frame stepping, renderer startup/transport fixes, 16-pass effect chains, the existing 2.0 toolbar fit, tests and this doc |
| Resolume parity build | Phase 1 started. Three worktree agents paused mid-task; nothing from them is merged |
| Next up | Qualify the hardware path in a signed build and on more machines; continue the phase 1 clip-launching features after the playback milestone |

---

## 2. Shipped

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

## 3. Done but not committed

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

**Still to check before release:**
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

### Native VJ startup and responsiveness follow-up (2026-09-18, local changes)

Playback reliability is the current priority. These changes are implemented locally, not released:

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

Current limits still matter: the library pool retains at most six prepared decoder sessions, live playback at most eight, and the decoded-frame budget can reduce the resident pool further. Clips outside that pool can still incur cold-start latency. The macOS hardware path and persistent opening cache are implemented in the follow-up below. HAP and universal instant-playback coverage remain open; Windows implementation is tracked in the follow-up below. This is not a claim of Resolume performance parity.

Resolume's public documentation describes [GPU decompression for DXV](https://www.resolume.com/support/en/rendering-to-dxv) and its [native/OS video playback paths](https://www.resolume.com/support/en/video), but does not specify its complete clip-preload/cache policy. Do not assume it loads every entire clip into RAM.

Validation: full default Vitest suite passed (897 tests); after the final decoder thread change, the 22 core/video tests passed again. Rust release tests passed (71), desktop type/Svelte checks passed with 0 errors (existing warnings remain), and the production frontend build passed. Both opt-in native graph integration tests passed after correcting an outdated Flythrough expectation: its first frame includes the persistent curl-field bake, subsequent frames do not. Windows, a signed installed build, high-resolution multi-layer loads, and a long performance soak remain release checks.

### macOS hardware playback follow-up (2026-09-18, local build)

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

Validation for this hardware follow-up: release core build passed; all 36 core/playback runtime cases passed; 83 Rust tests passed (four opt-in cases ignored in the ordinary run; the macOS shim hardware fixtures were exercised separately); 587 ordinary app tests and 88 targeted sync/effect tests passed. Desktop checks found zero errors with existing warnings, and the production frontend build passed. `git diff --check` passed. All work is local and uncommitted.

**Remaining qualification and scope:** cold or evicted clips can still need preparation; the pool is bounded rather than loading every complete clip. Windows GPU qualification, HAP/DXV-style texture codecs, signed-package tests, other GPU models, full-resolution 4K composition, HDR color management, device-loss recovery during a set and a multi-hour soak remain open. Manual/offline frame capture and unsupported compatibility cases still use the existing FFmpeg path. No release was published by this work.


### First parity feature: longer effect chains

The shared limit is now 16 enabled passes for clip/layer chains, VJ composition FX and mapping composition FX. Extra enabled effects are bypassed with a visible warning in the effects panel; they no longer blank the working chain. Clip and layer effects share the combined chain's allowance. Disabled effects do not consume it. An unsupported effect beyond the limit cannot disable the first 16 supported passes.

Validated 12- and 16-pass chains in the real native core, including output pixels and intermediate-texture reuse; unit tests cover the 17th effect and disabled effects. This change adds capacity, not a guarantee that 16 expensive effects meet the frame budget on every machine.

### 2.0 toolbar fit

The same `fitToolbar` fix as 1.9.995, ported to 2.0 (`src/App.svelte`, `src/lib/utils/toolbarFit.ts`). On 2.0, "Mobile" was cut off at 1262 and 1200 px; it now fits there with only the tighter spacing, and is unchanged at 1440 px and wider. svelte-check 0 errors. Held for the next 2.x release (not 2.0.8 on its own, per decision).

---


### Windows hardware playback follow-up (2026-09-18, local implementation)

**Implemented for Windows builds; physical Windows playback remains unverified.** Media Foundation opens a persistent source reader on a worker, using a D3D11 hardware device created on the renderer's exact D3D12 adapter. H.264 and HEVC decode to NV12/P010 textures. A GPU video processor converts into pooled shared RGB surfaces; a shared GPU fence orders D3D12 sampling. Supported playback never maps, reads back, or uploads raw video pixels through CPU memory.

- Hardware status is set only after a real decoder-bound DXGI texture passes format, memory-access and device-identity checks. CPU output and software adapters are rejected. Automatic CPU-to-texture upload is disabled. Unsupported codecs, profiles, geometry, HDR/unsupported color metadata and missing hardware support use the existing explicit compatibility fallback in `auto` mode; `hardware` mode reports failure.
- NV12 uses BGRA8 conversion. P010 uses RGBA16F or RGB10A2, with no 8-bit conversion downgrade. SDR matrix/range conversion targets the renderer's Rec.709 space; driver support is checked before use. Full HDR color management remains outside this implementation.
- Reuse the shared prepared opening cache, generation checks, media timestamps, pause/resume, loops, trim controls and memory admission. The source reader stays open across seeks/retriggers. A bounded compressed-tail timing probe during preparation excludes longer audio tails from the video loop duration.
- Each decoder owns its D3D11 context and converter, with best-effort Windows MMCSS Playback scheduling on its worker. GPU outputs, shared handles/imports and texture views are reused. Input samples remain retained until video conversion completes; immutable output frames remain retained through renderer completion. Producer retirement is bounded, and GPU waits have timeouts/device-removal reporting on the media worker.
- Windows reports `media-foundation` sessions, `NV12`/`P010` source formats and `native-video-dxgi` transfers. The shared handoff budget conservatively includes converted output and input-surface storage; opaque codec-reference allocations and the renderer atlas remain separate. Prepared coverage is still bounded, and a cold/evicted clip can take time to prepare.

The Windows compiler check covers the renderer and all Rust test targets. A dedicated non-publishing Windows CI workflow compiles/links the tests and runs pure Windows video policy tests. It has been added locally, not dispatched. Runtime suites and the four-clip benchmark now support both platforms and reject silent software fallback. A Windows-only test holds one texture while three other decoder queues advance, checking that pooled surfaces are not overwritten.

Local regression evidence: the Mac release rebuild passed; all 84 ordinary Rust tests passed (four opt-in hardware cases ignored), including 13 shared stream/memory lifecycle tests and validation of the actual Windows blit shader; the three hardware runtime suites passed 15 cases with the Windows-only case explicitly skipped. The updated benchmark also completed 32 prepared retriggers on the M1 Max with zero underflows, software frames, fallback or CPU video uploads. These results verify the shared implementation and Mac behavior, **not Windows playback speed or driver compatibility**. Consolidated evidence is in `reports/windows-hardware-video-local-validation-2026-09-18.json`.

Before calling Windows show-ready, run the commands in `docs/WINDOWS_HARDWARE_VIDEO_VALIDATION.md` on physical NVIDIA, AMD and Intel hardware, including hybrid-GPU laptops. Verify sustained playback, first-frame color, rapid prepared triggers, seek/loop behavior, Main10 codec availability, device-loss recovery, signed packaging and a long soak. No Windows performance numbers or built Windows installer are claimed from this Mac session.

### Native scrubbing and frame stepping follow-up (2026-09-18, local implementation)

**Implemented locally in the layer and VJ video controls:** dragging the playhead sends seeks directly to the native playback session. Supported hardware clips reuse their persistent decoder and GPU surfaces without launching one-shot FFmpeg previews. Rapid drag updates are coalesced, and cancelling a drag or changing the source prevents an older request from committing its position to the new source.

Previous/next-frame controls pause playback and select the adjacent actual source timestamp, including variable-frame-rate video. They start from the frame actually shown, clamp at the trim edges, and leave the decoder ready to resume after the selected frame. macOS uses compressed-sample cursors; Windows uses a bounded search through decoded presentation timestamps. The macOS checks also exposed and fixed an HEVC open-GOP seek issue that could omit a leading B-frame near a keyframe boundary.

The native session reports the displayed source time, frame duration, source frame rate, source duration and seek generation. Unknown metadata stays unavailable. A step is confirmed only after its generation has presented a frame; the ordinary state-sync echo does not repeat the step. The UI requires a prepared session with exact stepping support and reports when that is unavailable. Compatibility playback can still seek, but the UI does not claim exact frame stepping from an estimated frame rate.

Validation for this follow-up:

- Seven scrubber helper tests passed, including cancellation and source-change races, plus five keyboard-routing cases protecting focused timeline arrows without breaking learned shortcuts. The helper, broker and scene-sync regression run passed 83 tests; desktop type/Svelte checks found zero errors.
- The full Rust suite passed 87 tests, with five opt-in cases ignored in that run. Six standalone macOS hardware tests passed, including 696 adjacent-frame, trim-edge and continuation checks across H.264, HEVC and variable-frame-rate fixtures.
- The three hardware runtime suites passed 18 cases; the Windows-only case was explicitly skipped. New output checks cover eight rapid seeks ending on the requested frame, adjacent steps within a constant-rate trim, and genuine variable-rate source-timestamp stepping followed by resume. Supported hardware cases continue to reject CPU video-pixel uploads and silent software fallback.
- The macOS release build and Windows all-targets compiler check passed. Physical Windows runtime behavior remains unverified.
- The rebuilt Mac development app was checked with the user's Wire Circuit clip in mapping and VJ modes: forward/backward frame buttons, focused timeline arrows, paused dragging, and playing drag/release. A saved backup preserved the open project across the app restart. Mapping frame steps read 5.600 → 5.633 → 5.600 seconds; VJ forward steps read 6.333 → 6.366 seconds at the clip's 30 fps.

This is local, unreleased functionality. These tests establish frame selection and transport behavior on the tested Mac, not zero latency for arbitrary compressed-video seeks or general show readiness. Signed-build acceptance, Windows GPU qualification and longer performance testing remain open.

### Continuous mouse and MIDI scratching follow-up (2026-09-18, local implementation)

The scrubber now allows one seek to present a picture before submitting the latest pending drag position. Intermediate input positions are coalesced instead of cancelling every decoder result during sustained movement; mouse release can replace the unfinished request once with the final position. Cancellation, clip changes and newer transport actions revoke pending work.

Paused hardware scrubbing reuses the actual containing frame and contiguous successors from the decoded ring, plus a history of recently decoded frames. Available shared-budget headroom can expand that history up to 96 frames or 64 MiB per session, whichever is smaller; otherwise it keeps the existing small cache. Nearby forward targets can continue the decoder instead of restarting from a keyframe. Cache lookup respects source timestamps, VFR duration and trim/session identity. Resume and required memory pressure release the optional history and idle Windows GPU pool allocations before returning their reservation; a scratch cache must not block a later live clip. This does not preload an entire clip or remove the cost of uncached backward seeks in long-GOP footage.

Both timelines are MIDI-learn targets named **Scratch (hold frame)**. Use **Cmd/Ctrl+M → click the timeline → move an absolute knob/fader → Esc**. Values span the current trim range and hold playback paused until Play. Existing `position` mappings still follow an external running timeline; re-learn the timeline to get scratching. Dedicated paths are `map:media:scratch`, `vj:<layer>:video:scratch` and `vj-b:<layer>:video:scratch`. Rapid CC bursts keep the final value. Mapping and Deck B transport commands now use native play state, including silent clips with no browser video element.

Standard 7-bit MIDI CC provides 128 positions across the selected range; it cannot address every frame of a long clip. The existing absolute pitch-bend mapping supports 14-bit input. Physical MIDI controller qualification remains open.

Measured on the user’s 960×540, 30 fps Wire Circuit H.264 clip (8 seconds with only its opening keyframe), using the same real scrubber helper before and after native history changes: 480 input positions over 8 seconds, repeatedly moving 3→5→3 seconds. Observed presented timestamp changes increased from 78 to 235 (9.75→29.38 per second); each two-second reverse leg showed 60 frames after the change. The 95th-percentile gap between observed changes fell from 182.45 to 49.96 ms. The final requested position held the correct containing frame. This is renderer-status sampling, not physical input-to-display latency. The expanded cache reserved 63,515,664 optional bytes within the 128 MiB shared test cap, with no CPU pixel uploads, software fallback, one-shot decode, decoder errors or error toasts. Details: `reports/native-continuous-scratching-2026-09-18.json`.

Final validation: **133 control/helper tests**, **96 Rust tests** (5 ignored), and **22 Mac GPU runtime tests** passed; one Windows-only DXGI runtime case was skipped. The release build and Windows all-targets compiler check passed. GPU checks include continuous forward/reverse output, correct final-frame hold, resume releasing optional history, new clip admission at unchanged and reduced memory caps, and preserving history when a new clip fits without reclamation. The live Mac app was reopened with the saved Wire Circuit project; Mapping and VJ mouse drags, playing drag/release, and both MIDI Learn scratch labels were verified. The app remains open for controller testing.

## 4. Paused agents (phase 1)

Each ran in its own git worktree with its own ports. Stopped mid-task on 2026-09-18. Nothing is merged. Review each diff before merging; none has been run through `npm run check:desktop` or `npx vitest run` to completion.

| Work | Worktree / branch | State when stopped | Left to do |
|---|---|---|---|
| **Lock the LAN remote** (pairing token for the port 9001 WebSocket and its HTTP listener) | `.claude/worktrees/agent-a162380e72cc88d38` / `worktree-agent-a162380e72cc88d38` | Mostly written, about 575 lines: `server/pairing.cjs`, `server/ws-server.js`, `server/ws-server.d.ts`, `src/lib/remote/`, `electron/main.js`, `electron/mcp-server.cjs`, `electron/preload.cjs`, `src/App.svelte`, `src/lib/components/MobileApp.svelte`. It also touched `src/lib/stores/shaderLibrary.ts`, which looks unrelated and needs a look. | Finish verification: unpaired client refused, paired client can change opacity, token reset unpairs, QR still pairs in one scan. Checks and tests. |
| **Clip launching behaviour**: column beat snap, trigger styles (normal/toggle/piano), fader start, ignore column trigger, lock layer, autopilot, cue points, tempo nudge and resync | `.claude/worktrees/agent-adcf1bd5b1ad2ccd2` / `worktree-agent-adcf1bd5b1ad2ccd2` | About 800 lines across `vjClipLauncher.ts`, `layers.ts`, `VJModePanel.svelte`, `midiRouter.ts`, `oscBindings.ts`, `keyboardStore.ts`, `controlPaths.ts`, `autoEngine.ts`, `docs/osc.md`, plus new `launchClock.ts`, `vjLaunchRules.ts`, `LaunchTempoControls.svelte`, `VJClipCuePoints.svelte`, `VJClipLaunchOptions.svelte`. Stopped while wiring the deck grid (column queue state, layer lock, options button, cell badges). | Finish the grid UI, unit tests (random bag, column queue, trigger styles, lock), verification in the dev app, `layerPersistence.test.ts` for the new VJClip fields. |
| **MIDI controller lights** (APC40 mkII, APC mini mk2, Launchpad X / Mini mk3, plus learned-pad feedback for any controller) | `.claude/worktrees/agent-aafe30a26511adf01` / `worktree-agent-aafe30a26511adf01` | Research only, no code written. | Start over from the brief in the appendix. |

Merge notes: the clip-behaviour work and the layer transitions work (phase 1, not started) both change the trigger path in `vjClipLauncher.ts` (`immediateTriggerClip`). The agent was asked to keep its changes in small helpers so the two merge cleanly. Worktrees need `node_modules` and the core binary symlinked from the main checkout.

---

## 5. Outstanding and known issues

In priority order.

1. **VJ startup and green first pass: fixes implemented locally.** See section 3. The existing native path already blocked browser video uploads; the earlier YUV explanation was a hypothesis, not a confirmed cause. Startup races discarded prepared decoders, and missing native video textures could expose a placeholder fill. Repeat acceptance in the signed installed build before release.
2. **Commit and release the loop fix** once VJ mode is checked (section 3).
3. **Mapping-mode lag.** The loop fix halves decode work for 30 fps clips and removes the loop stalls. New clips now start at their in-point, covered by a sync regression test. Signed-build acceptance remains.
4. **Trimmed loops** still relaunch ffmpeg every pass (now with a full pass of head start). A very short trim can still stall if a launch is slow. The full fix is phase 2's frame cache or HAP path.
5. **ffmpeg launch time.** In dev the unsigned `ffmpeg-static` binary is checked by `syspolicyd` (first launch 0.4 to 3 s). Measure launch time with the signed binary in the installed app. If still slow, keep one warm decoder per clip instead of launching on trigger.
6. **Windows checks:** the 2.0.7 preview-alignment fix on a scaled display, and the `source_fps` expression with the Windows ffmpeg binary.
7. **Behaviour change to watch:** layers with an old warped mesh now show it in Corner mode too. Reset Mesh clears it.
8. **Suggested follow-ups already written up as tasks:**
   - The render core outlives its app when the app is killed (orphaned `ghost-render-core`, parent PID 1).
   - Every Screen bound to a VJ row renders its own copy of the row (its own shader or crossfade graph) instead of sampling the one feed frame: an N-times GPU cost in STAGE mode.
   - Native core timing tests still use fixed sleeps and are flaky under load.
9. **Carried over from earlier, status unclear:** a downloads-page section on 2.0 vs 1.9 system requirements, and moving the logo and content up under the stage on mobile. The mobile hero ground was made seamless (ghostarcade-web `2de5bb2`) and the stage zoom removed on phones (ghostarcade-web `437ba69`), but the requirements section and the logo shift were not confirmed done.
10. **Housekeeping.** `reports/` contains committed native validation summaries alongside untracked local diagnostics, particle bench stills and an unrelated brief; stage only specific relevant evidence files. Dev processes may still be running: vite on 1420 (2.0) and 1421 (1.9 worktree), and a dev Electron on CDP 9234 using a throwaway profile.

---

## 6. Resolume parity plan: everything left

Based on Resolume Avenue and Arena 7.26 (manual plus the 7.24, 7.25 and 7.26 release notes) against the 2.0.7 source. Sizes assume one developer working with Claude: **S** a few days, **M** one to two weeks, **L** three weeks or more. The phases are ordered; each builds on the last.

### Where Ghost Arcade already leads (protect these)

- AI control that works live: MCP server plus the Director agent. Resolume added MCP in 7.26, but it only builds compositions and can't touch slices, mappings or presets.
- Generative content: 309 ISF shaders, 11 native particle, fluid and smoke instruments, gaussian splats, 3D models, three.js and p5.js.
- Stage Sim (3D venues) and Map Sim (projection onto 3D objects).
- Stage Designer with 17 Screen FX chases, hand-tracking control, SynthVision, the mobile app, WLED output.
- Free and open source; Arena is €799.

### Phase 1: play a whole set without workarounds (about 6 to 8 weeks)

| Item | Size | Status | Done when |
|---|---|---|---|
| Effect chains with no silent limit | M | Implemented locally; 12/16-pass native output tests pass | Up to 16 enabled effects render; the 17th shows a warning while the first 16 remain active |
| Layer and clip transitions (0 to 10 s, style per layer, per-clip override) | M | Not started; design below | A new clip on a layer set to a 1 s dissolve fades in with no black frame |
| Trigger behaviour: beat snap for columns, trigger styles, fader start, ignore column trigger, lock layer | S | In progress (agent, paused) | A column fired mid-bar lands on the next bar; a piano pad plays only while held |
| MIDI feedback to controllers | M | Research only (agent, paused) | An APC40 grid mirrors deck A; a queued clip blinks until it fires |
| Autopilot and cue points | M | In progress (agent, paused) | Random bag plays each clip once per cycle; a cue pad jumps within one frame |
| Tempo nudge and phrase resync | S | In progress (agent, paused) | Resync on a phrase start realigns every BPM-locked clip and LFO |
| Lock the LAN remote | S | Mostly written (agent, paused) | An unpaired device on the same network can't read or change the show |

**Effect chain implementation.** `nativeEffectChainPolicy.ts` shares the 16-pass cap and overflow wording across the sync layer, Canvas and effects panels. The core already reuses two intermediate textures. Overflow is a warning, not a layer-pending error that would block the supported chain. Per-pass cost still scales with chain length.

**Transitions design.** Reuse the 10 crossfade shaders (`vjCrossfadeNative.ts`) as a per-row transition carrier, the same way `vj-xfade-N` works between decks. The launcher keeps the outgoing clip alive for the transition time, `nativeEffectiveLayers` in `Canvas.svelte` emits a carrier whose mix animates 0 to 1, and `resolveNativeGroupLayers` routes Screens to it. The 2.0.7 job ordering (`frame_job_stage`) and pipeline warm-up already cover the two failure modes that caused the deck-B flash.

### Phase 2: video that holds up at 4K (about 8 to 10 weeks)

| Item | Size | Status | Done when |
|---|---|---|---|
| Hardware decode (VideoToolbox, Media Foundation/D3D11VA), frames kept on the GPU | L | macOS implemented and exercised; Windows implemented locally and cross-checked; physical GPU qualification pending | Four native-resolution 4K clips at source rate with bounded memory, no CPU pixel uploads, and measured input-to-display latency on supported GPUs |
| HAP, HAP Alpha, HAP Q as compressed GPU textures | L | Not started | 16 simultaneous 1080p HAP clips at 60 fps; HAP Alpha edges composite correctly |
| Native resolution, native frame rate, more streams | M | **Partly done** (uncommitted): hardware decodes at coded resolution and source timestamps; GPU scales into the configured atlas. Direct native scrubbing and exact adjacent-frame stepping, including VFR, are verified on macOS. Still 8 playing streams; Windows runtime and full-resolution 4K composition remain unqualified | A 25 fps clip plays at 25 fps, frame-accurate against the BPM-locked playhead |
| Reverse, bounce, and a playhead locked to the beat | M | Not started | A 4-beat loop stays on the bar for 10 minutes against Ableton Link |
| Media workflow: image sequences as clips, converter writing HAP / HAP Q / ProRes, media manager (relink, collect) | M | Not started | A project moved to another machine opens with every clip found or listed for relinking |
| Clip audio like Resolume: on by default, volume and pan per clip and layer, output device choice, driven by the core clock | M | Not started | A music video's sound stays in sync through speed changes and scrubbing |

Seamless untrimmed loops (section 3) are a down payment on this phase.

### Phase 3: Arena-grade stage I/O (about 10 to 12 weeks)

| Item | Size | Status | Done when |
|---|---|---|---|
| More than 8 screens (`MAX_SLICE_OUTPUTS`), native screen windows and deck monitors on Windows | L | Not started | Windows drives 5 projectors plus a UI monitor from the core with no editor relay |
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
- **Phase order:** the user's current priority is immediate, reliable live video response. Playback latency and prepared-clip coverage take priority over further parity features; move the opening-frame cache and hardware decode forward where performance measurements require them.
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

## Appendix: agent briefs (condensed, for restarting)

**Lock the LAN remote.** Generate a random pairing token per install, persisted and resettable (reset unpairs everything). Show it in the Connect Mobile popup and embed it in the QR URL so pairing stays one scan. Reject WebSocket upgrades and HTTP requests without a valid token (constant-time compare); the desktop app's own connection presents it too. The phone remembers its token and explains a rejection plainly. Consider sharing a token source with `electron/mcp-server.cjs` without changing its bind address. Keep the 10 MB `maxPayload`. Verify with a Node `ws` client with and without the token.

**Clip launching behaviour.** In `vjClipLauncher.ts` and `VJModePanel.svelte`, with triggers also arriving from MIDI, OSC and the keyboard:
- Column triggers follow quantization, and a second click cancels a queued column.
- Per-clip trigger styles: Normal, Toggle, Piano (release path for mouse, MIDI note-off, key-up, OSC 0).
- Per-layer options: Fader Start, Ignore Column Trigger, Lock.
- Per-clip autopilot: after N loops or N beats go to next, previous, random, random other, random bag, first, last, a specific column, or nothing; always through the normal trigger path.
- Up to 8 MIDI-learnable cue points per video clip.
- Hold-to-nudge tempo, and a Resync that makes now the downbeat (disabled with a tooltip while following Ableton Link).
- Persist everything with the project, and keep the trigger-path changes in small helpers so layer transitions can merge alongside.

**MIDI controller lights.** Open outputs through the same Web MIDI access, auto-paired to the input by name. Profiles for APC40 mkII, APC mini mk2, Launchpad X and Launchpad Mini mk3, with note maps, palettes, channels and SysEx taken from the manufacturers' protocol documents and cited. Show the selected deck's current block on the grid: off for empty, dim for loaded, bright for playing, blinking for queued, with deck A and B in different hues and paging when the grid is wider than the device. Also light learned pads (clip triggers and toggles) on any controller. Send only changes, batched per frame, and clear on close. Add a Controller lights block in Settings > MIDI. Verify with a fake Web MIDI device injected before load.
