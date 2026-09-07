# Native renderer implementation evidence — 2026-09-06

See [implementation details](../../NATIVE_PERFORMANCE_IMPLEMENTATION_2026-09-06.md) and the [original baseline](../native-renderer-2026-09-06/README.md).

Environment: Apple M1 Max, Metal, release native core, local macOS checkout. Tests run in isolated native-core processes. The native preview addon was rebuilt, but the Electron presenter/provider fixture is a contract stub rather than a measurement of an attached projector.

Commands:

```sh
npm run native:full-check
node scripts/native-live-reliability.mjs --churn=1000 --soak-seconds=30 --perf
node scripts/native-performance-benchmark.mjs
```

The long rehearsal command is `npm run native:soak` (1,000 revisions plus four hours). It is a synthetic shader/slice test and must be supplemented with the actual media, cameras, recording and displays used in a show. A short successful run cannot prove the absence of leaks.

The performance probe reports completed submissions at 1080p with a 60 FPS target. Its readback workload uses the same diagnostic snapshot RPC as the original baseline; its implementation now maps and measures pixels off the render thread. It does not measure file export or MP4 encoding. The existing benchmark uses a different 120 FPS target and fixed quality. Do not combine their rates as one capacity estimate.

Resource samples include process RSS and core allocation estimates. RSS does not account for every GPU/driver allocation, and retained caches can legitimately increase while warming. Submission-interval percentiles are not physical display cadence.

Files:

- `final-reliability-results.json`: final 60-change visible-churn checks, five-second idle sample and five performance workloads; source stores remain 1024 pixels.
- `retention-1000-before-warm-fallback.json`: longer retention run that exposed whole-program holding during continuous cold-shader updates. Retained as diagnostic evidence; the hold was corrected afterward.
- `final-performance-and-churn-100.json`: intermediate validation of continued submissions after the fallback correction, before asynchronous diagnostic readback.
- `visible-churn-60.json`: visible-layer progress test after the fallback correction, before asynchronous diagnostic readback.
- `existing-benchmark-results.json`: the separate fixed-quality, 120 FPS target color/Planet benchmark.

The final complete gate passed. See `validation-summary.txt` for its results and `validated-build.json` for source/binary hashes. The final managed-window smoke was occluded; it verified continued shared output, not physical presentation.
