# Windows review of the latest Mac-side work

Reviewed `bb97237..e03ed945` plus the local column-launch fixes. GitHub refs were refreshed; `origin/codex/clip-transitions` still points at `e03ed945`. Windows host: NVIDIA GeForce RTX 4070 Laptop GPU, D3D12 / Media Foundation. Local edits have not been committed or pushed.

Follow-up: the user's larger interactive grid exposed additional warm-pool count and Windows texture-memory limits that the initial six-video test did not cover. Those are addressed and measured in [the larger-grid fix report](windows-grid-launch-fix-2026-09-20.md), which identifies the current test package.

## Findings and fixes

1. **Decoder eviction churn — fixed.** The bounded paused decoder pool removed a decoder but retained its transport record. The next render tick recreated it and evicted another prepared clip. A three-paused-row/six-preroll regression produced 155 additional evictions in 500 ms before the fix. Eviction now retires the transport and unused frame resources as well, protecting sources referenced by graphs, scheduled launches and pending preparations. The regression passes with a stable pool.
2. **Windows HAP conversion and packaging — fixed.** The `ffmpeg-static` Windows executable lacks HAP encoding; eight tests originally failed with `Unrecognized option 'compressor'`. Windows builds now automatically provision a SHA-256-pinned FFmpeg 8.0.1 full build and ship it with upstream notices and provenance in `resources/ffmpeg`. Packaging checks HAP, HAP Alpha, HAP Q and Snappy support. HAP conversion selects this executable for both input probing and encoding; a separate FFmpeg installation is unnecessary. Explicit `GA_FFMPEG_PATH` overrides remain available. CI now provisions and tests the encoder on Windows.
3. **Windows test coverage gap — fixed.** The VJ handoff tests used an extensionless executable path and silently skipped Windows. They now locate `ghost-render-core.exe`. LUT tests use the canonical `d3d12` backend name. HAP fixture generation uses the same verified encoder selection as conversion.
4. **Earlier column changes retained.** Prepared sessions take precedence over seeking an existing decoder; a source is handed off once at its exact prepared anchor; participating transitions start with one shared timestamp. Sequencer and A/B controls remain on the right of the blocks row.

## Beeple playback evidence

An isolated Electron profile loaded two columns of three 1280×720 clips from the user's Beeple folder: `building tubes`, `mocircshii`, `triangle_field`, `atommy`, `archimedes`, and `cycloid`. Quantization was OFF. Ten alternating column launches, approximately 900 ms apart, exercised the real launcher → Canvas → native renderer path.

- Every launch made all three incoming sources GPU-ready in the same polling round: 34.275–48.965 ms from calling the column trigger.
- Zero decoder evictions, software frames, hardware fallbacks, stream underflows or dropped commands during the recorded run.
- 904 hardware frames; maximum native decoder trigger latency 3.994 ms.
- The earlier normal-app log recorded native trigger delays up to 1.467 seconds. That is a different workload, not a controlled before/after benchmark; the controlled eviction regression above establishes the lifecycle defect independently.
- These are source-readiness/decoder timings, **not mouse-to-projector scanout latency**. Cold media outside the bounded preparation pool still needs decoding.

Machine-readable evidence: [Beeple launch results](windows-latest-beeple-launches-2026-09-20.json). The isolated test profile was removed; the user's normal profile and media were preserved.

## Automated validation

- Recent non-renderer feature suite: 454 initially passing tests; the eight failing HAP conversions passed after the fix. The full conversion suite passed all 13 cases, including alpha and sequence filenames.
- Recent native runtime features: 51 tests passed on Windows covering H.264/HEVC, reverse/bounce and transport controls, clip audio, transitions, queued launches, LUTs and VJ handoffs. HAP's eight runtime tests passed after encoder selection was corrected.
- Playback/pool suite: 10 passed, including the new eviction regression and three-row prepared launch.
- Changed renderer/group/effect suites: 104 passed across 10 files, including real GPU composition/group feed checks.
- Focused synchronization, transitions and encoder-selection suites: 92 passed.
- Rust: 134 passed, 2 explicitly ignored fixture-dependent tests.
- Desktop checking: zero errors, 1,038 existing warnings. Production frontend build passed. Windows native release rebuilt with DXC present.

Counts overlap across the focused suites; they are not a single additive total. Detailed logs are in `scratchpad/windows-audit-*.log`, `windows-latest-*.log`, `windows-hap-converter-fixed.log`, and `windows-preroll-fixed.log`.

## Bundled HAP verification

- Conversion, encoder selection and native HAP runtime suites: 25 passed. After adding the empty-PATH regression, all five resolver tests passed (26 distinct tests across these suites).
- The actual unsigned Windows app package built successfully. Its packaged Electron runtime resolved `resources/ffmpeg/ffmpeg.exe` and converted HAP, HAP Alpha and HAP Q with PATH restricted to Windows System32 and no `GA_FFMPEG_PATH` override. Native core, DXC, shaders, FFmpeg license/readme and provenance were present. The initial OneDrive staging rename failed; packaging succeeded outside OneDrive.
- Three simultaneous 1920×1080/60 HAP clips on the RTX 4070 used `hap-texture` throughout a five-second measured interval: 60.27 compositor fps and 60.27 fps per clip, zero dropped frames, underflows, software frames, hardware fallbacks or decode failures. This is a short throughput check, not an endurance qualification. [Machine-readable results](windows-hap-throughput-2026-09-20.json).
- Package: `C:\Users\justi\AppData\Local\Temp\ghost-arcade-hap-check-20260920\win-unpacked\Ghost-Arcade.exe`. Logs: `scratchpad/windows-hap-package.log`, `windows-hap-bundled-tests.log`, `windows-hap-resolver.log`, `windows-hap-packaged-smoke.log` and `windows-hap-throughput.log`.

## Remaining Windows acceptance

The recent work does require Windows-specific handling; passing Mac tests or a cross-compile was insufficient. This pass does not qualify every physical show setup:

- Independent native per-Screen texture outputs remain unimplemented on Windows; their capacity test is explicitly Mac-only. Shared group feeds within the main stage composition are a different, tested path.
- Actual projector/fullscreen output, DPI/display combinations, physical MIDI feedback and disconnect/reconnect, real Ableton peers, audio-device hotplug, capture/recording and multi-hour endurance still need their hardware acceptance runs.
- Native clip audio in recordings and transition-matched audio tails remain unfinished upstream features, not regressions addressed here.

See `docs/WINDOWS_ACCEPTANCE_2026-09-20.md` for the broader physical acceptance checklist.
