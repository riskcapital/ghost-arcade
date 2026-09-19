# Native HAP implementation and acceptance

Local changes on `codex/clip-transitions`; not a release or Windows runtime qualification.

## Playback path

The MOV reader indexes `Hap1`, `Hap5` and `HapY` samples, expands optional Snappy/chunk compression on a media worker, and sends BC1/BC3 blocks to the GPU. GPU sampling decompresses colors; a shader reconstructs HAP Q YCoCg. Frames do not pass through FFmpeg or CPU RGBA during supported playback. Compressed block uploads are counted as uploaded bytes, separately from hardware-decoder frame imports.

The shared preparation, source-time, exact-step, seek-generation, memory-admission and GPU-retirement rules also apply to HAP. HAP texture bindings are reused while dimensions/format remain unchanged. A media drain submits its HAP conversions together, retaining frame storage and memory leases until GPU completion. The live-session ceiling is 16, plus bounded transition overlap; actual admission still depends on the shared byte budget. The library retains up to six prepared sessions. This does not guarantee every cold or evicted clip starts instantly.

MOV transforms, non-square pixels, cropping, complex edits and unimplemented HAP variants use compatibility playback. The reader bounds index, packet, dimensions, sample counts and decompression output. It does not implement clip audio or HDR.

## Checks

- Rust parser/chunk/shader tests and six real MOV combinations of codec and compressor.
- Three real Metal output comparisons against independent FFmpeg reference pixels: HAP, HAP Alpha and HAP Q, with transparent/translucent/opaque regions, warm preparation, seeking and repeated exact adjacent-frame steps.
- Existing native hardware playback, ten-bit input and transport regression suite: 31 passed, one Windows-only skipped across HAP, hardware-video playback, ten-bit input and transport after the capacity/pacing/buffer changes.
- Mac desktop import through Add Files: thumbnail, one-second duration, launch, paused mouse/keyboard stepping in 40 ms increments for a 25 fps clip, and saved-project reopening.
- Desktop and mobile type checks pass with existing warnings; production web build passes.
- Simulated MIDI shutdown regression verifies pad clearing and held-input release before Electron exits.

## Throughput method and limits

`scripts/native-hap-throughput-benchmark.mjs` generates a two-second 1920×1080 60 fps HAP fixture, copies it to 16 distinct files, and runs independent looping sessions. It measures source presentation and compositor rates, checks every output tile, and reports compressed upload bytes, memory reservations, underflows and fallback/failure counters. Output is 1920×1080 with a 512-pixel atlas slot and a 1024 MiB decoder budget. This is a short, filesystem-cache-friendly core test, not full-resolution multilayer 4K composition, physical input-to-display latency, a packaged-app set, or storage/thermal soak qualification.

Initial measurement: decoders approximately 59.84 fps each, compositor 50.89 fps, no underflows/fallbacks. Batching alone: compositor 50.11 fps; target not met. Both failed results are retained. Inspection found that wake-up jitter rebased the compositor deadline each frame. Scheduling now preserves its phase for sub-frame jitter and rebases after a whole missed interval to prevent catch-up bursts. A deterministic scheduling regression covers both cases.

Windows compilation checks pass; actual Windows HAP playback and physical VJ controllers remain unqualified.

After the pacing correction, sixteen HAP streams produced 59.94 compositor fps and approximately the same source rates, with all tiles visible and zero underflows/fallbacks/decode failures. HAP Alpha then exposed greedy buffer admission: early streams reserved eight-frame rings while later streams waited. HAP now uses a three-frame ring, appropriate to its independent indexed frames. With that correction, sixteen HAP Alpha streams produced 59.49 compositor fps with all tiles visible and zero underflows/fallbacks/decode failures. The initial admission failure is retained separately.

HAP Q reached 59.99 compositor fps across sixteen clips with all tiles visible and zero underflows/fallbacks/decode failures. Throughput reports retain measured rates rather than promising exactly 60.000 fps on every machine. HAP Alpha/Q require more memory than HAP RGB; the 1 GiB test budget is material to these results. The smaller ring reduces buffering headroom and needs longer storage/thermal testing.

Import metadata now includes dimensions measured before thumbnail scaling and after FFmpeg's container rotation. Those dimensions are carried through library placement, preroll and native source-aspect handling, and persist on VJ clips, mapping sources and media-library items. A portrait-video project round trip and all six converter/import formats verify duration and dimensions. Corrupt import failures produce a filename-specific error and do not stop the rest of a batch. Final Mac visual check completed after unlocking: a fresh HAP Alpha import reports its one-second duration, launches, and renders a square image with black side bars using Contain. The saved HAP test also reopened with its clip intact.

Final automated checks: 129 control/import/persistence tests pass; 31 native playback tests pass with one Windows-only skip; 105 Rust tests pass with six opt-in tests ignored in that invocation. Desktop checks report zero errors/1037 warnings; mobile checks zero errors/52 warnings. Production build and Windows cross-compilation pass. The HAP Alpha throughput sample recorded two dropped source frames across all sixteen streams during approximately ten seconds (HAP RGB and HAP Q recorded zero); its near-60 result is not a zero-drop guarantee.
