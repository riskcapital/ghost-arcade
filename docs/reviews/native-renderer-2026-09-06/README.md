# Review evidence

See the [full review and plan](../../NATIVE_PERFORMANCE_REVIEW_2026-09-06.md).

- [probe-results.json](probe-results.json): measured isolated GPU checks and extended short workloads.
- [existing-benchmark-results.json](existing-benchmark-results.json): recorded fields from the repository's existing native performance benchmark.
- [probe.mjs](probe.mjs): diagnostic reproduction script. It collects observations, not pass/fail assertions; it intentionally demonstrates current failures.

Run from the repository root on macOS, with graphics-service access:

```sh
cargo build --release --manifest-path native-renderer/Cargo.toml --offline
node docs/reviews/native-renderer-2026-09-06/probe.mjs --perf
```

The probe creates its own native core process, closes it on completion, prints results, and writes `/tmp/ghost-native-review-probe-results.json`. It does not connect to the user's running application. Omit `--perf` to run just the short correctness/cache/transport checks. Benchmark the existing two-workload fixture with `node scripts/native-performance-benchmark.mjs`.

The blocked-pipe test uses a deliberately stalled in-memory Writable, not a real clogged OS pipe. The pipeline test changes shader source comments under the same ID to create distinct source hashes. It sets `pipeline_metadata_cache_cap` to 2 before creating eight new variants. The drain test sets the limit to 2 and submits 10 commands; its empty-layer color commands make this a policy test, not a realistic heavy-command stall benchmark.

The throughput probe uses 16 overlapping translucent color layers, 1024-pixel source frames, performance policy, 1080p output, and a 60 FPS target. Four-second samples follow one-second warmups. FX are blur, invert, pixelate and brightness. The readback case requests output pixels internally but suppresses base64 in the reply; it includes GPU-to-CPU transfer and frame statistics, but no file writing or encoder. Slice passes currently omit composition FX, so their measured workload is not a correctly effect-processed multi-output implementation.

Recorded values are short local runs. CPU/GPU EMA fields have the coverage limitations described in R13. Completed-frame counters measure main core submissions, not physical display timing. No long-session memory slope, Windows runtime result, or final live-rig qualification is represented by these files.
