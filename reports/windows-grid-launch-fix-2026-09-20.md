# Windows larger-grid launch delay

The interactive test log recorded native trigger-to-first-frame spikes of 328.506 ms and 535.639 ms. The project grew to 12 clips, beyond the six-library-decoder pool used by the earlier six-video benchmark.

## Causes and changes

- The library pool discarded earlier preparations after six entries; frontend arm signatures still considered those clips prepared. The pool now holds up to 16 library videos, with a separate total paused-session bound of 32 to allow paused stage sources alongside the grid. Pointer entry and keyboard focus on a column refresh preparation without the library's 20-second debounce.
- Increasing the count alone was insufficient: a real Beeple run exhausted the 512 MB decode budget after seven 720p clips, leaving an incoming 1080p clip waiting for memory. Windows retains decoder surfaces plus RGB bridge textures. Prepared Windows hardware streams now use two queued frames rather than four; cold live streams retain their larger ring. The desktop Windows decode budget is 1,024 MB, allocated on demand and enforced by the existing shared accounting. Other platforms retain 512 MB.

## Real-file verification

The final native-core test loaded 12 distinct Beeple MP4 files, including 720p and 1080p videos, then launched four columns of three clips four times. Each consumed preparation was replenished before the next launch. This tests prepared launches, not clicks during initial media loading.

- All three incoming sources ready in 14.76–34.92 ms across all 16 launches.
- Maximum native trigger-to-first-frame latency: 9.521 ms.
- Zero decoder evictions, software frames, hardware fallbacks or decode failures.
- Final reserved decode memory: 862,978,048 bytes, below the 1 GB limit.
- Hardware: NVIDIA GeForce RTX 4070 Laptop GPU / D3D12.

These are native source-readiness measurements, not mouse-to-projector latency. [Detailed measurements](windows-beeple-twelve-grid-2026-09-20.json).

The new 12-video regression failed against the previous binary (six retained preparations instead of twelve) and passed with the expanded pool. Type-checking found zero errors and 1,038 existing warnings; the production frontend and native release builds completed.

Final validation: all 19 native playback/HAP tests and all 77 synchronization/transition tests passed. The native suite covers loop seams, exact seeks/retriggers, memory reclamation and the 32-session eviction bound. Tests received a 20-second startup allowance after the earlier 5-second defaults timed out during concurrent builds; launch-readiness assertions were not relaxed. The eviction regression now waits for preparation to complete before measuring stability instead of assuming 32 decoders finish within one second.

The unsigned package at `C:\Users\justi\AppData\Local\Temp\ghost-arcade-grid-final-20260920\win-unpacked\Ghost-Arcade.exe` contains the exact tested core (SHA-256 `E4BA8F6628A8DC947A90CC5920AA39974905DB52CD5305A6A1BC464A6D5365BF`). Packaged HAP, HAP Alpha and HAP Q conversions passed with only Windows System32 on PATH. Logs: `scratchpad/windows-grid-playback-final.log`, `windows-grid-sync-final.log`, `windows-grid-package-final.log`, `windows-grid-packaged-hap.log` and `windows-beeple-grid-final.log`.

Larger grids or heavier media can still exceed the bounded preparation pool. The previous interactive window continues to use the earlier binary until restarted.
