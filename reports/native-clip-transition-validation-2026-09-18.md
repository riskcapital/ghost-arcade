# Native clip transition validation — 2026-09-18

Local development implementation on `codex/clip-transitions`, after synchronizing with the shipped 2.0.8 branch. This report covers the render core and automated GPU checks; the desktop controls and project persistence have separate application checks. No Windows GPU runtime result is claimed here.

## Native behavior

- Graph producers run before consumers by actual source dependencies, including nested clip transition → A/B deck transition → VJ Mix → Screen. Queued per-clip effects also run before persistent carriers that sample their outputs.
- `get_layer_source_readiness` checks the currently displayed source, a completed GPU picture, and an optional expected media source/seek generation. `get_source_frame_readiness` checks raw video separately when the layer displays an effect-chain output. The coordinator checks both for token-isolated incoming layers.
- Input/shader/output changes invalidate a graph's readiness; mix, time, and sequence updates preserve it. New video seek generations invalidate the preceding picture's readiness while retaining its visible pixels.
- `capture_layer_source_frame` copies the raw layer source and mip levels on the GPU. There is no pixel readback or CPU upload. Snapshot IDs are bounded to `vj-clip-snapshot-{A|B}-{0..31}`. Capturing requires a completed picture and a free source slot.
- Captured carriers hold their current output until the next accepted graph installation. This prevents a repeated interruption from making the old fade blend an overwritten snapshot again during the host/native command gap.
- Snapshot references in graph bindings participate in source ownership. `release_source_frame` refuses to release a referenced snapshot; unused snapshots are released explicitly. Snapshot allocation and general source allocation never evict a referenced live picture on exhaustion.
- Clip uniforms receive current input source rectangles and readiness flags. This keeps centered hardware-video frames correctly sampled and lets the outgoing picture remain while the incoming source is missing.

## Capacity and memory tradeoff

The supported baseline remains **8 playing video sessions total**, with up to **8 additional sessions during active clip transitions**. Armed sessions retain their separate limit of 8. Single-input idle carriers and ordinary A/B crossfades do not enable the temporary overlap. Shared atomic decoder-memory admission remains unchanged.

The source array grows from **24 to 48 slots** to accommodate retained inputs and transition carriers. The three source stores at 1024-pixel SDR resolution require approximately **704 MiB**, previously approximately **352 MiB**. The performance/balanced/ultra source-store budget is explicitly **768 MiB**, previously 384 MiB. The source-size chooser continues to account for all stores, pixel format, and adapter texture limits. The status field `source_array_texture_bytes` reports the estimated allocation.

This deliberately retains the existing SDR sampling resolution and uses more memory. It is not a claim of unbounded streams or full native-resolution 4K composition. Sixteen already-playing videos across two banks exceed the existing eight-session baseline. Exhausted decoder or source capacity must leave the outgoing picture held and surface a capacity error; GPU snapshots refuse admission when no free slot exists.

## Verified checks

Host: Apple M1 Max, macOS, Metal/VideoToolbox. Desktop development app closed during the automated GPU run.

- Rust unit suite: **101 passed, 5 existing ignored**. Includes graph dependency ordering, queued-effect ordering, readiness epochs, structural invalidation excluding frame sequence, and bounded snapshot identifiers.
- Windows cross-compilation: **`cargo check --target x86_64-pc-windows-msvc --all-targets` passed**. This is a compile check, not D3D12 runtime qualification.
- Combined Mac GPU run: **30 passed, 1 Windows-only skipped, 5 files**. It includes eight new transition tests and 22 existing hardware playback/10-bit/fallback checks. Files used the runner's default parallelism; elapsed time is not a performance benchmark.
- Transition ownership cases verify independent copies after source overwrite, expected-source matching, release refusal for graph-only references, full source-capacity refusal, nested Screen routing, structural readiness invalidation, and repeated interruption with a 100 ms gap before host rebinding.
- Shader pixel cases cover all ten styles, partial-alpha lower-row visibility, independent geometry/opacity/contain margins, absent incoming sources, padded source rectangles, and nested clip/deck/VJ Mix composition.

- Final dedicated transition rerun: **9 passed across 2 files**, serially with `--no-file-parallelism`. This adds a real hardware H.264 seek-generation check, including rejection of the previous GPU completion while a new seek waits, and verifies full-canvas source rectangles when a video layer becomes a graph carrier. All nine cases pass on the updated core.
- Completion epochs also use a monotonic atomic update, with a unit assertion for out-of-order old/new completion updates, so an older callback cannot regress newer readiness.

## Desktop application verification

The Mac desktop controls were exercised using an isolated profile and project; user settings were not changed. A 10-second dissolve visibly progressed red → pink → blue and finished. Repeated mid-fade red/blue → VideoToolbox-video triggers preserved the mixed picture. A Yellow clip with duration 0 cut immediately; its independent Wipe override displayed. Changing the layer to a 1-second dissolve worked, and Stop All cleared the output.

The saved `.gha` was inspected: layer transition duration 1 and Yellow clip override duration 0/style `wipe` persisted. Frontend validation reported 0 errors and 1,036 existing warnings; production build passed. Related checks passed for store/coordinator/persistence (27), transition helper (10), combined native sync/helper/crossfade/mix (80), and broker (20). These overlap and are not added into a single total.

## Reproduction

After building the native core, run the dedicated transition suites:

```sh
npx vitest run --config vitest.native.config.ts --no-file-parallelism \
  src/lib/renderer/nativeClipTransitions.runtime.native.test.ts \
  src/lib/renderer/vjClipTransition.runtime.native.test.ts
```

The ownership suite requires FFmpeg for its generated H.264 fixture. Tests select the platform's native binary and hardware decoder, and wait for decoder shutdown before removing fixtures on Windows.

Existing playback regression files:

```sh
npx vitest run --config vitest.native.config.ts --no-file-parallelism \
  src/lib/renderer/nativeHardwareVideo.runtime.native.test.ts \
  src/lib/renderer/nativeHardware10Bit.runtime.native.test.ts \
  src/lib/renderer/nativeVideoFallback.runtime.native.test.ts
```

Windows D3D12 execution, physical MIDI/controller latency, and full simultaneous-show capacity/performance still require machine testing. These checks verify rendered pixels and bounded ownership, not physical input-to-display latency.
