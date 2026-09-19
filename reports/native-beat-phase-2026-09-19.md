# Native beat-phase following

## Behavior

In the VJ transport, choosing a beat/bar length now enables phase following for hardware loop and bounce playback. Forward and reverse are supported on either deck. Targets follow the same shared clock used for quantization, including its Ableton Link source when connected.

The frontend keeps a phase anchor per deck/layer and publishes targets every 100 ms through a separate command channel. It does not rewrite the project, rebuild the clip graph, or increment seek generations. Tempo changes preserve the anchor. Pauses, manual seeks/cue jumps, retriggers, trim/mode changes and phrase resync establish a new anchor. Unquantized launches retain their chosen phase offset; quantized launches start on their selected boundary.

The native core measures phase against the continuous decoder presentation clock. It uses the shortest cyclic phase error and a two-second settling horizon with a ±4% rate-adjustment ceiling. It retains the decoder and queued frames. Commands must match the source URI and seek generation; paused, non-looping and unavailable streams are ignored. Corrections expire after 500 ms without targets and restore nominal speed.

Selecting Free disables following. Once mode, missing durations, software/compatibility playback and requested fits outside the supported speed range do not receive hardware phase correction. Paused clips retain their position. Corrections are runtime-only and are not saved.

## Validation

- Frontend phase/persistence tests: 101 passed. Phase tests cover reverse/bounce coordinates, many elapsed cycles, tempo changes, discarded row anchors, pauses, seeks and unsupported content.
- Rust: 111 passed, 6 ignored. A deterministic ten-minute simulation covers clock skew and multiple tempo changes, maintaining error below 2 ms after settling; this is mathematical validation, not a hardware endurance run.
- Three Mac GPU tests passed with real H.264 playback in forward, reverse and bounce. Each introduces an approximately 100 ms target offset, publishes targets for 5.5 seconds and checks a final native-clock error below 25 ms. Frames continue and corrections expire after targets stop. These measurements are the presentation clock's error, not camera-measured display latency.
- Full hardware/HAP playback regression: 32 passed, 1 platform-specific skip, including looping, scratching, warm launches, retiming and the new phase tests.
- Desktop checking: zero errors (existing warnings remain).
- Frontend production build, native release build and Windows cross-compilation passed.

## Remaining qualification

A ten-minute real Ableton Link peer test with visible output, Windows runtime testing, HAP-specific phase endurance, and overload/device-loss behavior remain open. Large clock discontinuities deliberately converge gradually rather than seeking. The decoder clock can advance despite overload; this feature cannot promise delivery of every frame on an overloaded GPU.

The desktop app must restart to load the new native binary. The isolated tests do not replace or restart the renderer serving an open user project.
