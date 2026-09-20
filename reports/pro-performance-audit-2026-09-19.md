# Professional performance audit — September 19, 2026

First source-level pass across native presentation, recording, video textures, audio mixing, scheduling and persistence. This is an audit, not a completed optimization or whole-app performance certification. Findings below identify actual paths; speedups require before/after runtime measurements. The initial audit made no playback changes; the implementation checkpoint below tracks subsequent work.

## 1. Fix shared-file audio cache thrashing first — confirmed algorithmic problem

`native-renderer/src/clip_audio.rs:52–65,180–215`: the mixer keys Reader by asset path. Reader has one 8192-frame window. The inner loop alternates voices for each output sample. Two voices using the same file at positions farther apart than the window overwrite the same cache repeatedly.

A small model of the exact refill condition, two voices one second apart, counted 256 window refills for 128 output samples (16 MiB requested) versus two initial refills with separate voice windows. This is a deterministic algorithm model, not measured storage throughput. OS caching does not eliminate seeking, copying and float reconstruction. The CPAL callback itself correctly avoids disk I/O; the risk is starving its producer.

Fix: independent per-voice cursors/windows over shared immutable PCM assets, or a bounded shared block cache with voice-local cursors. Prefetch around reverse/bounce boundaries; budget memory and release stopped voices. Validate the same file on two decks at different cue points and opposite directions, with measured reader misses, mixer block p99 and underruns.

## 2. Move performance scheduling out of the UI thread — confirmed dependency, impact needs measurement

`src/lib/stores/vjClipLauncher.ts:595–634` fires quantized triggers through requestAnimationFrame. Autopilot also uses RAF around line 3446. Beat-phase targets use frontend setTimeout every 100 ms (3613–3665). `src/lib/sync/abletonLink.ts` polls native Link every 250 ms. Native playback is independent, but new scheduled actions and correction delivery still depend on frontend availability.

Fix: send timestamped/beat-addressed launch intentions, cancellation IDs and a native clock anchor to a native scheduler. Preserve column atomicity, Piano release ownership, tempo changes, locks and deck independence. Native/native clock exchange should replace renderer-mediated phase delivery. Do not equate this with automatically following Live transport.

Validate with intentional 100–500 ms frontend stalls while native presentation continues. Measure missed deadlines and actual presented frames, not just the UI beat counter. Keep manual immediate triggers immediate.

## 3. Remove the recording GPU → raw file → encoder route — confirmed expensive path

`src/lib/recording/offlineRender.ts:606–640` exports each frame to a temporary raw file; live recording can reuse that file across missing frame indices. `native-renderer/src/main.rs:start_live_capture` reads GPU output back and writes the raw pixels on a worker. `electron/main.js:writeMp4FrameEncoderFrameFile` synchronously reads the file in the main process, then pipes bytes to the encoder.

The readback is already off the presentation loop: preserve that isolation. But storage, copies and main-process synchronous work remain. A 3840×2160 BGRA frame is 33,177,600 bytes; at 60 unique frames/s the raw payload is about 1.99 GB/s before counting write-plus-read and other copies. This is arithmetic, not measured SSD traffic, and scales down with actual recording resolution/rate.

Fix: first replace temporary files/main-process reads with bounded native encoder queues; then evaluate platform hardware encoder input from GPU-backed surfaces. Hardware encoding alone does not remove the input readback. Preserve correct timestamps, audio muxing, backpressure, cancellation, color conversion and alpha format constraints. Live overload must not block presentation; offline exports must retain every requested frame.

Validate recording off/on at actual 1080p60/4K, GPU and CPU p99, duplicate/drop count, memory, output duration and A/V alignment.

## 4. Move splat video textures onto the native media path — confirmed CPU round trip

`src/lib/sync/nativeRendererSync.ts:loadNativeSplatTexture` creates an HTML video, draws to a 2D canvas and uses getImageData; the splat render branch repeats it for new video frames. Textures are capped at 512 pixels on the longest side. The source comment explains that stored data URLs prevent direct native decoding.

Fix durable file-backed texture references and bind existing native decoded textures to the splat graph. Keep an explicit browser-only fallback and migrate embedded assets safely. Preserve manual/offline clocks, cancellation, looping and project collection. This improves both CPU cost and the current texture-resolution limitation, but workload-wide gain depends on use of splat video textures.

## 5. Debounce durable settings writes — confirmed work on editing path

`src/lib/stores/settings.ts:1260–1280`: saveSettings encrypts fields asynchronously and then serializes the full settings object into synchronous localStorage. Many setters invoke it directly. Fast screen/color/warp edits can queue redundant serialization/encryption/writes. Async saves also warrant an ordering test.

Fix a revisioned, coalesced writer: apply live controls immediately, save only the latest revision, flush on explicit save/appropriate lifecycle events. Verify final state survives rapid edits/restart. Profile long tasks while dragging a dense rig; do not claim a performance defect from JSON.stringify alone.

## 6. Batch screen submissions and make confidence monitors demand-driven — confirmed work, benefit unmeasured

`native-renderer/src/main.rs:render_slice_outputs` creates and submits a command encoder per screen. The presentation path renders deck monitors when content exists or requires a clear, rather than using visible-subscriber demand at this call site.

Evaluate one bounded submission for independent screen passes, preserving export synchronization and immutable per-pass uniforms. Track actual monitor consumers before suppressing work; native/output windows may need feeds even with editor panels hidden. Preserve the final clear when content disappears.

Do not blindly replace every screen render with a master blit: the current needs_detail/allow_direct branch deliberately preserves per-screen crop/warp resolution. Benchmark 1/4/8/16/32 outputs at stated resolutions and measure submit CPU, GPU time and memory.

## 7. Audit shared VJ feeds and effect graphs — candidate, not yet proven duplicate cost

`nativeRendererSync.ts:6200–6240` redirects mapped targets to VJ source objects. Further graph generation is per layer. Earlier parity notes flag repeated row rendering, but this pass does not establish which already share native carrier textures versus reconstruct work.

Trace source/graph identities for one expensive VJ row mapped to 1/4/8 Screens. Count actual graph dispatches and effect passes. Share canonical pre-screen feeds only where semantics match; keep screen-specific warp, crop, blend, grade and FX downstream. Avoid caching across changed audio/time inputs.

## 8. Audit per-frame control traffic and allocation — candidate

Native broker control uses JSON; stateBroadcast clones/serializes payloads; native sync includes signatures and RAF animation. Some are already deduplicated or gated. Do not replace the control protocol wholesale before measuring it.

Instrument bytes and commands per frame, redundant updates, main/UI long tasks, allocation/GC and queue age. Move continuous effect/LFO evaluation into the native engine where profiling shows value; keep setup/project metadata on the readable control plane.

## Preserve the work already done

Hardware video texture import/conversion, compressed HAP uploads, retained openings, bounded decode/history caches, async diagnostic readbacks, pipeline warming and allocation-free audio callback are existing strengths. Do not mistake fallback/diagnostic code for the live default or remove necessary synchronization simply to reduce a counter.

## Order and acceptance

1. Reproduce/fix shared-file audio readers.
2. Add a repeatable performance scene and native/UI timing counters; test deliberate UI stalls.
3. Native launch/phase scheduling.
4. Recording transport and native audio mux integration.
5. Native splat textures; settings persistence coalescing.
6. Profile and then optimize multi-screen graphs/submissions/monitor demand and IPC.

Use a fixed scene matrix: cold/warm triggers, same-file A/B audio, long-GOP reverse/bounce, heavy effects, many mapped screens, recording and UI editing. Capture frame interval p95/p99/max, launch-to-first-picture, audio underruns, GPU readback/upload bytes, queue latency and memory growth. Repeat on M1 Max and the Windows RTX machine. Physical projector/audio latency needs external measurement. No fixed percentage speedup is claimed by this audit.

## Implementation checkpoint

Implemented in the working tree:

- Independent audio reader windows per voice and asset, with 128-sample block mixing. Shared-file voices no longer replace each other's read windows.
- Persistent authenticated loopback frame transport from native readback to the recording encoder, with bounded in-flight capture, backpressure and cancellation. Live recording no longer writes/reads temporary raw frame files. GPU readback and software encoding remain.
- File-backed live splat video textures use native decoding; owned auxiliary sources participate in playback and release on replacement. Embedded/remote and manual-clock textures retain the browser fallback.
- Revisioned settings persistence coalesces rapid edits, rejects stale prepared writes and flushes on explicit composition save.
- Main-process Link clock delivery plus native phase extrapolation removes frontend timer dependence for ongoing Link phase correction. Clock loss expires correction after 500 ms.

Still outstanding: native quantized launch and Autopilot transactions; GPU-surface hardware encoder integration; recording audio mux; measured multi-screen submission/monitor/graph optimizations; control-traffic profiling. Screen-pass batching requires separate immutable uniforms because the current shared uniform buffer relies on submission ordering.

No percentage speedup or live-performance certification is claimed. Windows compilation is a compatibility check, not Windows GPU/runtime verification. Long-duration, high-resolution recording and real Link-peer stress tests remain necessary.

Validation at this checkpoint:

- 186 frontend regression tests passed; desktop type check: zero errors (1038 existing warnings).
- Three coalesced-writer tests and two binary-stream tests passed.
- Rust release tests: 115 passed, six ignored; Windows cross-compilation passed.
- Real macOS GPU/audio tests passed. The new runtime test verifies auxiliary hardware video advances and releases, three persistent captures encode into a six-frame MP4, Link phase continues with no further frontend phase messages, and stale-clock correction expires.
- JavaScript syntax and whitespace checks passed.

### Autonomous live recording follow-up

Live recording cadence now runs in Electron main, independent of frontend RAF. A serialized monotonic clock limits each capture batch to 120 frames and waits for the active capture on stop. UI polling only reports status. Explicit cancellation stops the clock; editor destruction/crash attempts to finalize completed footage. Library duration uses the encoder's actual frame count. Main-process stalls and encoder overload can still duplicate frames; this does not remove GPU readback or add hardware encoding/audio mux.

Validation: three cadence tests cover independent ticks, bounded slow capture, stop waiting and failure shutdown; two binary-stream tests pass. The real GPU test now also records using the autonomous clock and verifies the MP4 frame count against completed captures. Native launch scheduling remains pending: complete prepared scene transactions and cancellation/acknowledgement semantics are required, because current trigger handlers still construct effects and transitions in frontend state.

### Native launch execution foundation

Added a bounded native queue for prepared media/layer mutations, reachable through desktop bridge APIs. It supports monotonic relative deadlines or Link beat deadlines, per-lane revision fences, replacement/cancellation receipts, a 64-pending/2-MiB queue budget and 128 retained receipts. Clock reset, manual rendering and renderer stop cancel pending work. A missing/changed/unready media source or removed layer rejects the transaction before participating rows mutate. Expensive graph construction, output resizing and recursive scheduling are not accepted launch commands.

Validated with four scheduler unit tests, a native GPU runtime transaction test (no frontend ticks between enqueue and execution), 25 bridge/launch-clock regression tests and Windows compilation. The runtime test covers replacement, stale cancellation, deadline execution, rejection without partial row changes and manual-clock cancellation.

This is an opt-in execution foundation, not a completed launcher migration. Quantization and Autopilot still use their existing frontend path. Integration must prepare hidden incoming graph/effect state, preserve outgoing transition state, provide source-generation ownership, fence overlapping column/row transactions, reconcile native receipts without retriggering playback, and cancel stale intentions on every edit/stop/Piano release. Library duration/tempo changes and random Autopilot choices also need an explicit native contract. The current queue does not promise atomic visual readiness across asynchronous decoder retriggers or hardware presentation timing.

### First launcher integration: prepared video cuts

Manual quantized single-clip video cuts now use the native queue when the existing row is a direct single-deck video layer, the incoming/outgoing geometry and aspect match, and both use forward looping playback without audio, beat-fit, effects or fades. Local manual BPM and Link are supported; audio-detected timing, columns, Piano triggers, Autopilot-originated triggers, dual decks, mapped/graph outputs and transitions retain the established path. Unprepared/unsupported sources fall back before native ownership is accepted.

Preparation uploads a paused incoming frame without changing the visible row. Native admission checks the expected outgoing source and seek generation. Queued source references prevent orphan release while waiting. A native binding guard prevents stale frontend scene reconciliation from restoring the old source after the cut; an acknowledged incoming bind, cancellation, layer removal or a deliberately newer seek releases it.

The frontend owns only preparation and outcome reconciliation, not the accepted launch deadline. Execution receipts include their age so the playhead resumes from the running position instead of retriggering. Cancellation races reconcile already-applied work; retries reuse their cancellation revision, and an obsolete enqueue failure cannot cancel its replacement. Failed accepted launches clear the pending indicator and notify the user.

Validation includes native GPU video preparation/cut, stale-bind rejection, intentional retrigger override, cancellation receipts, controller replacement/cancellation races, and existing launcher/sync regressions. This is not the complete native quantization/Autopilot migration, and does not certify physical output latency or Windows runtime behavior.

### Prepared native column launches

Eligible manual quantized single-deck video columns now prepare all participating incoming frames and submit one native transaction. Every participating row must satisfy the straight-cut requirements; one unsupported or empty destination keeps the entire column on the established path. Locked and ignore-column rows retain their normal exclusion behavior. Keyframe-driven playback also stays on the existing path.

Native resource revision fences protect overlapping layer transactions across lanes: a newer row replaces an overlapping queued column as a whole, disjoint work remains queued, and a delayed older column is rejected. Callers must use globally increasing revisions for overlapping resources. Expected-source guards and first-frame readiness are validated before any participating row changes. The frontend reconciles all matching rows in one store update and preserves newer manual changes. Admission requires the new native_launch_resource_fences capability, so an older running core safely retains the existing route until restarted.

Validation: seven scheduler unit tests; three real macOS GPU runtime tests, including two-row prepared video launch, rejection without partial changes, and overlapping row replacement; 170 frontend regressions including whole-column admission/fallback and protected-row exclusion. Desktop type checking has zero errors (1038 existing warnings); Windows cross-compilation and whitespace checks pass. Windows runtime and live-show stress testing remain outstanding.

Still outside this native launch route: dual decks, mapped/graph output, effects/fades, Piano, Autopilot scheduling, audio-detected timing, empty/new rows and same-clip retriggers. No physical zero-latency guarantee is implied. Changes remain local and uncommitted.

### Shared-source scheduling safety

Before extending native launches to dual decks, added source-level conflict fences as well as layer fences. Pending transactions that bind or mutate the same source now replace one another as whole transactions, and older cross-lane arrivals are rejected. Layer and source resource names are separate namespaces. Native execution also verifies that a playback command still matches the prepared seek generation and that the uploaded frame matches the current media generation. A ready frame from a newer seek must not authorize an old queued rewind.

The A/B graph already uses stable layer-frame inputs, so a future deck cut can preserve its crossfade topology. Dual-deck frontend admission/reconciliation and runtime graph-output validation are still required; dual-deck native scheduling is not enabled by this change.

Validation: nine scheduler unit tests and three real macOS GPU runtime tests pass. The runtime regression explicitly decodes a newer seek, attempts a stale column with an earlier visibility mutation, and verifies rejection preserves both the other row and the newer seek. Native release build, Windows cross-compilation, and whitespace checks pass. Windows runtime verification remains outstanding; this batch remains uncommitted.

### Dual-deck prepared cuts

Eligible manual quantized straight video cuts and columns now use deck-specific rows, grids, layer IDs and scheduling lanes. Receipt reconciliation updates only the originating deck. Native snapshot admission accepts the established A/B crossfade and VJ Mix carriers while requiring every target layer to remain bound to its expected outgoing source. The cut changes the media binding behind a stable layer-frame input; it does not rebuild or reset the crossfade graph.

Crossfader movement does not invalidate a prepared cut. Switching single/dual-deck mode changes the plan signature and cancels native ownership. Solo checks and held-input checks use the target deck. An outgoing source shared by multiple active rows remains on the existing path to avoid disturbing another row during playback reconciliation. Existing limitations on effects, fades, Piano, Autopilot, keyframes, audio timing, geometry changes, empty rows and same-clip retriggers remain.

Validation: 170 frontend regressions pass, including deck routing, deck-local solo, disabled-B rejection, shared outgoing-source fallback and crossfader signature behavior. Six real macOS GPU tests pass across native launch and A/B handoff suites. The new graph test schedules B then A at a 50% dissolve and checks rendered color contributions to verify the opposite deck and mix remain intact; existing tests cover prepared video playback and column atomicity. Desktop type checking reports zero errors (1038 existing warnings); whitespace checks pass. No native Rust changes in this increment. Windows runtime verification remains outstanding. Changes remain local and uncommitted.

### Native progress for started clip fades

Clip-transition carriers now send a transition token, duration and started state. Once the existing readiness coordinator starts a live fade, the native renderer anchors its progress and advances it without further UI writes. Repeated progress updates for the same token cannot rewind it; a new token starts a new clock. Graph removal and leaving live mode clear clock state. Manual/offline rendering continues to use supplied frame progress rather than elapsed wall time.

The frontend sync includes clock identity/start state in graph installation signatures, so readiness-to-running changes reach the core with the retained graph. This is autonomous progress for an already-started fade, not native quantized transition admission. Preparation, readiness acknowledgement, interruption snapshots and completed-resource cleanup still use the existing frontend coordinator. Started transitions retain their incoming final image if UI cleanup stalls.

Validation: 89 frontend transition/coordinator/sync tests pass; one native clock unit test covers advance, stale progress and token replacement; five real macOS GPU transition tests pass. The GPU regression verifies intermediate blending and completion with no progress writes, no rewind after a stale update, and fixed progress in manual mode. Native release build, Windows cross-compilation and desktop type checking pass (zero errors, 1038 existing warnings). Windows runtime testing remains outstanding. Changes remain local and uncommitted.

### Prepared transition deadline primitive

Added a bounded `start_prepared_transition` mutation to the native launch queue and desktop command type. It starts an already-installed clip-transition graph by token; no graph compilation or decoding occurs in the deadline action. Both declared source inputs must match the graph, be GPU-ready, and (for video) match their seek generations. The carrier must also have rendered. Queue source references keep the two frames available and participate in cross-lane conflict fences. Input rebinding and duplicate starts of the same carrier are rejected at admission.

Execution validates the full transaction before applying mutations. A successful start anchors native progress at zero and protects that token against delayed frontend prepared-state metadata, including metadata updates without a graph template. A replacement token or graph removal releases the protection. Cancellation before execution and clock-mode changes use the existing scheduler semantics.

This is the renderer-side deadline primitive. The VJ launcher still routes fades through its established trigger path: it must prepare hidden incoming/outgoing branches before the quantized boundary, then reconcile the native receipt into transition-store timing and cleanup. The existing straight-cut integration is unchanged. Do not claim complete native quantized fades or native Autopilot scheduling yet.

Validation: 11 scheduler unit tests, 98 frontend regressions, and nine real macOS GPU tests pass. New rendered tests cover a prepared red-to-blue fade starting only after its native deadline, cancellation retaining the outgoing image, rejection before partial mutations, delayed prepared metadata during the running fade, and obsolete-token rejection after replacement. Final native release build, Windows cross-compilation, desktop type checking (zero errors, 1038 existing warnings), and whitespace checks pass. Windows runtime remains unverified; all changes remain local and uncommitted.

### Canvas wrapper routing correction

Tracing pre-beat fade preparation exposed an integration gap in the straight-cut admission path: Canvas calls `buildVJClipTransitionLayers(..., true)`, so even steady rows have a canonical transition carrier plus a `__vj-clip:<row>:steady:in` media input. The prior scheduler looked for the outgoing video directly on the canonical row and rejected this actual Canvas shape, falling back to frontend timing. Earlier direct-layer runtime tests did not exercise that shape.

Queued cut preparation now resolves the steady media input from the native snapshot, while retaining compatibility with direct canonical media layers. It validates canonical carrier identity, expected outgoing input and the whole supported scene shape, and rechecks routing before submission. Scheduled binding guards and source-generation guards attach to the resolved input. Canonical transition carriers, A/B crossfade and VJ Mix stay in place. Active transition helpers, missing inputs, foreign carriers and mapped layouts remain on the existing route.

This corrects real Canvas routing for eligible cuts; it does not complete quantized fade launcher integration. Hidden fade-branch preparation and native receipt reconciliation into transition state remain next.

Validation: 170 frontend regressions pass, including direct and wrapped single-deck/A/B resolution, missing input rejection, foreign carrier rejection and active-transition fallback. All 13 macOS GPU handoff/playback/transition tests pass. The new runtime test builds the real steady clip wrapper followed by VJ Mix, schedules the inner media binding, verifies the final output changes, and verifies a stale outgoing binding cannot restore it. Final desktop type checking reports zero errors (1038 existing warnings); whitespace checks pass. No native code changes in this increment. Windows runtime verification and full quantized-fade launcher integration remain outstanding. Changes remain local and uncommitted.

### Preparation lifetime and replacement ordering

Before attaching hidden fade branches to queued launches, fixed an existing preparation/cancellation race. Native cancellation acknowledgement previously removed frontend ownership even while an asynchronous preparation write was outstanding. Ownership now remains until both cancellation settlement and preparation completion; cleanup runs exactly once after settlement. Preparation receives an `isCurrent` predicate so invalidated work can stop before further writes or readiness polling.

Preparations touching the same canonical row or incoming source are ordered. A replacement waits for outstanding predecessor writes; unrelated resources remain concurrent. Superseded jobs waiting behind another preparation exit without performing their own preparation. The launcher supplies row/source resource keys and checks current ownership around asynchronous preparation work. This protects current queued cuts as well as providing the lifecycle needed for hidden fade preparation; it does not enable native quantized fades yet.

Validation: 191 frontend launcher/sync/transition regressions pass, including cancellation-before-preparation-completion, delayed cleanup, overlapping replacement ordering, unrelated-row concurrency and rapid replacement chains. Desktop type checking reports zero errors (1038 existing warnings); whitespace checks pass. No native code changed in this increment. Hidden fade-branch preparation and receipt-to-transition-store integration remain outstanding. Changes remain local and uncommitted.

### First launcher integration for quantized video fades

Eligible individual manual quantized video fades now prepare paused incoming video plus hidden transition input layers before the boundary. The launcher active cell remains the outgoing clip; only the renderer feed substitutes the prepared incoming source behind a zero-progress carrier. Admission retains the straight-cut restrictions (known video dimensions/duration, matching geometry, forward loop, no clip audio/beat-fit/effects, visible unlocked rows, no keyframe/sequencer control). Fades within column triggers and overlapping transitions still use the established route.

Preparation waits for both helper layers, the incoming seek generation and the canonical transition carrier. One native transaction unpauses the incoming source and starts the prepared transition token. The ordinary readiness coordinator skips queue-owned fades. On an applied receipt, the launcher updates its active cell/playhead and confirms transition timing using receipt age; existing completion cleanup then resumes. Cancellation/failure retirement is token-specific and uses the preparation settlement ordering added earlier. Interrupting an uncertain queued fade requests a snapshot of the actual output.

Prepared video metadata is explicitly tagged in renderer-only source copies. The core ignores late preparation writes for the exact URI/generation of an incoming video already started by its scheduled transition; ordinary transport pauses and newer seeks remain effective. A capability gate keeps older running renderers on the existing path until upgraded/restarted.

This enables scoped individual fades on either deck; native column fades, effects/geometry-changing transitions, Piano, audio-detected timing, and native Autopilot timing remain outstanding. No application restart or live-show latency certification was performed.

Validation: 194 frontend regressions pass, including paused renderer-only preparation without changing the active launcher cell, stable plan ownership, cancellation restoration, receipt confirmation, stale-token protection and exclusion from ordinary readiness/start handling. All 14 macOS GPU playback/transition/handoff tests pass on the final rebuilt core. The new hardware-video case uses a hidden input layer, starts playback and fade together, sends a delayed paused preparation snapshot, verifies continued motion, then verifies a normal pause and a newer seek still work. Final release build, Windows cross-compilation, desktop type check (zero errors, 1038 existing warnings), and whitespace checks pass. Windows runtime verification remains outstanding. Changes remain local and uncommitted.

### Native column fades

Extended quantized fade preparation from one row to an entire eligible column. Each participating row owns its transition token, hidden paused input, style and duration. All rows must be ready before a single native transaction unpauses the incoming sources and starts every prepared fade. Receipt reconciliation updates the launcher rows together and confirms each matching transition from the same receipt age. Cancellation/failure cleanup is token-specific for every prepared row, preserving any newer manual replacement.

All-fade columns are admitted under the existing video/geometry/effect restrictions. All-cut columns retain their native route. Mixed cut/fade columns still use the established path because the current prepared-transition contract rejects concurrent input rebinding. Locked and ignore-column rows retain their normal exclusion behavior; an unsupported participating row keeps the whole column on the established route.

Validation: 194 frontend regressions pass, including per-row column styles/durations, renderer-only preparation of both rows, stable queued ownership and cancellation restoration. All 15 macOS GPU playback/transition/handoff tests pass; the added two-row fade test rejects a bad participant without starting the other row, then starts both valid fades in one transaction and verifies the combined rendered result. Final desktop type checking reports zero errors (1038 existing warnings); whitespace checks pass. No native Rust changes in this increment. Windows runtime testing remains outstanding. Changes remain local and uncommitted.

### Mixed cut/fade columns

Eligible quantized columns can now combine cuts and fades in one native launch. Only fading rows prepare hidden transition inputs; cut rows retain their resolved direct or steady-wrapper binding. Submission rechecks both types against the installed scene, then combines source playback, cut bindings and prepared fade starts in one transaction. Each fade retains its own style and duration. A new capability gate keeps older running cores on the existing route.

The scheduler now permits mixed command admission. Before applying any mutation, the renderer rejects a transaction that rebinds a prepared fade carrier or any of its layer-frame inputs. Independent cut rows are allowed. Existing source readiness, seek-generation and transition-token guards continue to validate the whole transaction before execution.

Validation: 11 scheduler unit tests, 194 frontend regressions and all 16 real macOS GPU playback/transition/handoff tests pass. The new GPU test verifies both unsafe carrier/input rebinds reject without changing the cut row, then verifies a valid mixed transaction changes that row immediately while the other row fades to completion. Final native release build, Windows cross-compilation, desktop type checking (zero errors, 1038 existing warnings) and whitespace checks pass. Windows runtime and live-performance stress testing remain outstanding. Changes remain local and uncommitted.
