# Hardware playback tempo retiming

## Change

Tempo/nudge changes previously changed the native stream signature and replaced the decoder session. Same-direction speed changes now settle the existing presentation clock at the old rate, then change its slope. The frame queue, decoder, cached opening, and frame counter remain intact. Paused streams remain paused.

The hardware worker retains its original timestamp scale. The consumer scales elapsed time relative to that original rate, so repeated adjustments do not compound the scaling. Reverse and bounce use the same mechanism. Explicit seeks, content/trim changes, and forward/reverse switches outside bounce continue through their existing transport paths. Software/FFmpeg streams do not use hardware retiming.

## Evidence

- Rust tests: 109 passed, 6 ignored. New tests verify clock settlement, queue retention, paused-state retention, and rejection of invalid rates, direction flips, and software retiming.
- Mac GPU acceptance: three real H.264 tests passed, covering forward, reverse, and bounce. Each applies rates 1.04, 0.96, 1.0001, 0.75 and 1.25 times its selected direction, verifies that the session frame count never resets, and waits for new frames after every adjustment. Hardware telemetry rejects software fallback.
- Full hardware/HAP regression suites: 29 passed, 1 platform-specific skip, covering existing looping, prepared launches and scratching alongside the new retiming tests.
- Release build passed.
- Windows cross-compilation passed; Windows runtime acceptance remains open.

## Limits

This removes decoder replacement from tempo adjustments. It does not yet correct phase against an external clock. The roadmap's ten-minute real-time Ableton Link phase-lock acceptance remains open. Tests run against isolated renderer processes; an already-running desktop renderer needs a restart to use the rebuilt binary.
