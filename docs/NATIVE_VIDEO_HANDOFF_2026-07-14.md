# Ghost Arcade Native Video Handoff

## Purpose

This workspace has been restored to the last known-good native-renderer checkpoint before the video lifecycle work began destabilizing GLSL, JS visuals, and the native presenter.

The checkpoint is identified from the Codex task history, not inferred from the current diff:

- **Checkpoint time:** `2026-07-13T21:30:22.105Z`
- **User confirmation:** `2026-07-13T21:31:45.246Z`
- **Confirmed good:** GLSL shaders and JS visuals in Mapping mode
- **Still broken at that checkpoint:** video startup, scrubbing, and looping
- **Original gate at checkpoint:** 46/46 targeted native tests passing

The authoritative task history is:

`/Users/justinwood/.codex/sessions/2026/06/23/rollout-2026-06-23T21-22-46-019ef738-f962-79a1-97da-789cf162a619.jsonl`

## Current Restored State

The post-checkpoint video experiments were reversed from the working tree in strict reverse order. The app has not been moved back to a browser renderer and no browser fallback should be introduced.

Current verification:

- `npm run check:desktop`: passes with existing Svelte warnings
- `cargo fmt --check && cargo check` in `native-renderer`: passes with two existing `kIOSurfaceIsGlobal` deprecation warnings
- Targeted native suite: 46/46 after rebuilding the release core from the restored source
- `git diff --check`: clean

The first post-rollback test accidentally exercised the stale, later release binary and reported 45/46. Rebuilding `native-renderer/target/release/ghost-render-core` from the restored source returned the checkpoint gate to 46/46. Tests in this file invoke the release binary directly, so always rebuild it before judging source changes.

Run the focused gate with:

```bash
npx vitest run \
  src/lib/sync/nativeRendererSync.native.test.ts \
  src/lib/renderer/nativeRendererCore.native.test.ts
```

## Non-Negotiable Architecture

1. Ghost 2.0 is fully native. Do not reintroduce browser rendering or a browser fallback.
2. GLSL/ISF and JS visuals are already native-enabled and were user-confirmed working at this checkpoint. Video work must not alter their clock, submission cadence, graph identity, or presenter path.
3. The render/core command thread must never wait for decoder startup, pre-roll, seeking, process exit, or frame availability.
4. The currently working native presenter must remain enabled while video is repaired. Do not combine presenter geometry, transparency, or window-host changes with decoder work.
5. Make one lifecycle change per commit and rerun the GLSL/JS smoke after every change.
6. Never allow an enabled native surface to silently produce black. Unavailable surfaces should be explicit; already-enabled surfaces are regression-protected.

## Baseline Video Architecture

The restored baseline contains:

- Persistent video playback streams created by `spawn_native_video_stream`.
- A bounded frame ring in `native-renderer/src/media_decode.rs`.
- Synchronous `wait_until_buffered` during media prefetch.
- Exact scrub requests represented by `NativeVideoScrubRequest`.
- One-shot exact-frame ffmpeg decoding through `decode_native_video_frame_exact_rgba`.
- Bucketed/cache frame decoding through `decode_native_video_frame_rgba`.
- Browser controls forwarding playback time and seek generations into native sync.

This baseline is intentionally not the final design. It is the point where shader and JS rendering were still stable.

## Baseline User-Visible Defects

At the checkpoint, the user reported:

- Video was slow to start.
- Moving the scrubber froze or stalled playback.
- Loops hung at the boundary.
- Video needed to be seamless and more reliable than shader playback.

The user was testing in **Mapping mode**, not VJ mode.

## Evidence Gathered After the Checkpoint

Live logs after the checkpoint isolated video as a command-thread and session-lifecycle problem, not a GPU-render-speed problem:

- During scrubbing and looping, native core cadence collapsed to roughly 0-12 FPS while GPU work remained near 2 ms.
- RPCs timed out while video lifecycle operations were active.
- Repeated interaction exhausted process slots, indicating decoder processes were being spawned or retained without a strict bound.
- `prefetch_media` could wait up to several seconds in the core RPC path.
- Scrubbing used exact one-shot ffmpeg processes, allowing rapid pointer movement to create a queue of obsolete jobs.
- Loop replacement occurred at or after EOF, guaranteeing a boundary gap.

These observations are useful. The attempted replacement architecture that followed was not stable and has been removed.

## Reverted Experiments

Do not reapply these as one large change. They were introduced after the known-good checkpoint and collectively led to worse video, shader/JS slowdowns, black output, and presenter/window corruption:

1. Asynchronous arm/prefetch state added directly into the existing session map.
2. A cancellable scrub-stream state machine layered beside exact scrub requests.
3. Promotion of a scrub stream into the active playback stream.
4. Continuous ffmpeg looping with `-stream_loop -1` plus trimmed-loop standby sessions.
5. Media-library-wide auto-arming of videos before placement.
6. Native playback-time mirrors and increasingly aggressive sync throttles.
7. Decoder child-process tracking and kill logic added across several ownership layers.
8. Host-window backdrop/transparency changes made while debugging video.
9. Shader-list deduplication and other unrelated cleanup mixed into the video pass.

The issue was not that every idea above was inherently invalid. The failure was introducing multiple ownership models and timing changes at once without preserving the known-good shader/JS gates.

## Files Most Relevant to the Regression

- `native-renderer/src/main.rs`
  - Native RPC dispatch
  - Media prefetch
  - Playback session ownership
  - Scrub requests
  - Frame selection and presentation
- `native-renderer/src/media_decode.rs`
  - ffmpeg process startup
  - Persistent stream producer
  - Bounded frame ring
  - One-shot frame decoding
- `src/lib/sync/nativeRendererSync.ts`
  - Layer-to-core video state synchronization
  - Seek generation and playback timestamps
  - Shader/JS submission cadence that must remain untouched
- `src/lib/components/LayerPanel.svelte`
  - Mapping-mode play, pause, restart, trim, and scrub UI
- `src/lib/components/VJModePanel.svelte`
  - VJ trigger path; secondary until Mapping mode is solid
- `src/lib/stores/vjClipLauncher.ts`
  - Clip arming/trigger lifecycle; do not use it to mask Mapping defects
- `src/lib/renderer/nativeRendererCore.native.test.ts`
  - Core media contract and trigger assertions
- `src/lib/sync/nativeRendererSync.native.test.ts`
  - Browser-to-native synchronization contract

## Recommended Debugging Sequence

### 1. Protect the checkpoint

Create a narrow checkpoint commit containing only the restored files before changing video again. Do not stage unrelated existing work.

Run and record:

```bash
npm run check:desktop
cd native-renderer && cargo fmt --check && cargo check
cd ..
npx vitest run \
  src/lib/sync/nativeRendererSync.native.test.ts \
  src/lib/renderer/nativeRendererCore.native.test.ts
```

### 2. Add observability before redesign

Expose per source:

- Active playback decoder count
- Active scrub decoder count
- Decoder PID and generation
- Buffered frame count
- Last decoded PTS
- Last presented PTS
- Trigger-to-first-motion latency
- Scrub-command-to-frame latency
- Loop-boundary frame delta
- Core command-loop latency
- One-shot decoder starts during playback

The render thread should never wait to gather these metrics.

### 3. Reproduce one defect at a time in Mapping mode

Use one synthetic 1080p H.264 clip with known frame numbers burned into the image.

Test separately:

1. Initial placement and first motion
2. Pause and exact single seek
3. Continuous scrub drag
4. Release scrub and resume
5. Full-clip loop crossing
6. Trimmed-loop crossing
7. Rapid replacement with a second clip

Do not start with five clips. Scale only after each single-source invariant is green.

### 4. Establish decoder ownership

There must be one authoritative owner for each source generation. A practical target is:

- At most one active playback decoder per source
- At most one temporary scrub/seek decoder per source
- New seek generation cancels and joins the obsolete seek generation off the render thread
- A stale generation can never publish a frame
- Playback resumes from the exact final scrub PTS
- Decoder startup and pre-roll happen outside RPC/render execution

Use bounded channels with latest-frame/latest-command semantics. Never allow pointer-move events to form an unbounded FIFO.

### 5. Preserve native shader and JS cadence

After every decoder commit, verify:

- Rapid GLSL shader switching remains smooth.
- Shader animation continues after parameters stop moving.
- JS visuals continue at full speed after parameter release.
- Core command latency does not grow while a video is decoding.
- No presenter geometry, opacity, title-bar, or host-window behavior changes.

If GLSL or JS slows, stop immediately and revert the decoder commit. Do not compensate with sync throttles elsewhere.

## Acceptance Gates

The video path is ready only when all of these are true:

- Armed trigger to first non-poster motion: under 16 ms.
- No green, gray, black, or stale frame on placement, trigger, seek, or loop.
- Scrubber tracks the requested frame during slow and rapid dragging.
- Releasing the scrubber resumes from the exact displayed frame.
- Full and trimmed loops cross with no repeated, missing, or frozen frame.
- Five simultaneous 1080p clips run for at least 10 minutes with no decoder growth, underflow burst, or RPC timeout.
- One-shot decodes during steady playback: zero.
- Core command-loop and render cadence remain stable while videos play and scrub.
- GLSL and JS smoke tests remain green and visibly smooth.
- Native presenter remains integrated with no desktop bleed, floating title bar, or window offset.
- The focused 46-test suite passes repeatedly, not just once.

## Working-Tree Warning

The branch contains a large amount of native-renderer work and unrelated dirty/untracked files. Do not run a broad reset, checkout, clean, or mass revert. Scope every commit explicitly and inspect staged files before committing.

The rollback performed for this handoff only targeted patches recorded after the checkpoint. Existing work from before the checkpoint and unrelated user files were preserved.
