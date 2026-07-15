# Native Video Engine Plan — Companion to NATIVE_VIDEO_HANDOFF_2026-07-14

This is the target design and commit sequence the handoff intentionally leaves open. It honors every handoff rule: no browser fallback, shader/JS cadence untouched, presenter untouched, one lifecycle change per commit, GLSL/JS smoke after each.

## 1. Root causes (mapped from the handoff's evidence)

| Evidence | Root cause in baseline code |
|---|---|
| `prefetch_media` waits seconds in RPC path; RPC timeouts | `session.stream.wait_until_buffered(...)` called from the command thread (`main.rs:9490`) |
| Cadence collapses to 0–12 FPS during scrub/loop while GPU is ~2 ms | Command thread blocks on decoder lifecycle (spawn/wait/seek), starving the event loop that also paces rendering |
| Process-slot exhaustion on repeated interaction | Scrub spawns a one-shot ffmpeg per pointer event (`decode_native_video_frame_exact_rgba` job queue); no single owner enforcing a per-source cap; obsolete jobs never cancelled |
| Loop hangs at boundary | Replacement stream is created **at/after** EOF — the gap is structural, not a tuning issue |

One sentence: **decoder lifecycle currently runs on the thread that must never wait, and nobody owns a source's decoders exclusively.**

## 2. Target architecture: one owner per source

### 2.1 `VideoSession` actor

One `VideoSession` per media source, running on **its own session thread**. It is the *only* code that may spawn, kill, join, seek, or pre-roll a decoder for that source. The RPC/command thread and the render loop never touch a decoder — they only exchange state with the session through two lock-free/bounded structures:

- **Desired-state slot (in):** a single-slot, latest-wins cell (mutex+swap or `watch`-style), written by the RPC thread in O(1), never blocking:
  ```rust
  struct DesiredVideoState {
    generation: u64,        // bumped on every seek/scrub/loop-edit/replace
    mode: Play | Pause | Scrub { target_pts: f64 },
    rate: f32,
    loop_range: Option<(f64, f64)>,   // trim-aware
  }
  ```
  Pointer-move floods therefore collapse automatically: the session only ever sees the **latest** target. No FIFO of obsolete jobs can exist (handoff §4: "never allow pointer-move events to form an unbounded FIFO").
- **Frame ring (out):** the existing bounded ring, extended so every frame carries `{pts, generation}`. Publish rule enforced at the ring: **a frame whose generation != current is dropped at publish time** — a stale decoder structurally cannot show a frame (handoff §4: "a stale generation can never publish").

### 2.2 Render-loop contract (unchanged hot path)

Frame selection stays a non-blocking peek: newest ring frame with `pts <= source_clock`. If the ring is empty, **hold the last presented frame** (never black, never green — handoff gate 2). The render loop performs zero waits, zero syscalls into decoder land.

### 2.3 Session state machine

`Idle → Arming → Ready → Playing ⇄ Scrubbing → Resuming → Playing`, plus `LoopStandby` as an overlay state. All transitions on the session thread.

- **Arming (instant trigger):** on placement/arm, spawn the playback stream, decode ~6–8 frames into the ring at the start point, pause. Trigger = flip clock running + present `ring[0]` in the same rendered frame → <16 ms to motion (gate 1). The poster/warmed-frame machinery becomes redundant and is deleted at the end (it is subsumed by `ring[0]`).
- **Scrubbing:** at most **one** scrub decoder. On desired-state change with a newer generation: signal-kill the stale scrub decoder (non-blocking; reaped by the session thread), start one seek at the latest target. While the exact frame decodes, immediately present the nearest already-cached ring frame as live feedback — the scrubber must *track* (gate 3), pixel-exactness follows ~1 decode later. Seek strategy: fast input-seek to previous keyframe (`-ss` before `-i`), decode forward to exact PTS.
- **Resuming:** playback restarts **at the exact final scrub PTS**: seek playback stream, refill ring (≥2 frames), swap, un-pause clock. The scrub frame stays frozen on screen during the refill — no gap, no jump-back (gate 4).
- **Looping (full and trimmed):** when the playhead enters the final ~500 ms of `loop_range` (or immediately, for clips shorter than 2× pre-roll), spawn the **standby** decoder at `loop_start`, pre-roll ring B, and at the boundary swap rings atomically on the pts comparison — boundary delta must be exactly one frame period (gate 5). The old decoder is killed and reaped off-thread. `-stream_loop` stays banned (reverted experiment 4): it cannot follow live trim edits and hides the boundary from the generation model.

### 2.4 Process budget and registry

Hard caps, enforced by the session (and audited globally): **per source: 1 playback + 1 scrub + 1 loop-standby.** Global cap (default 12 decoder processes) with LRU eviction of sessions for non-visible sources. Every spawn/exit updates a registry `{source, role, pid, generation, spawned_at}` surfaced verbatim in status — this *is* the handoff's observability list, kept truthful by construction. A sweep on the session manager kills any decoder whose generation is ≥2 behind (belt-and-braces against leaks; its firing is a logged anomaly, not normal operation).

### 2.5 Clock ownership (fixes the mirror thrash)

The core's per-source clock is **authoritative**. The UI sends *intents* only — play, pause, seek(pts, generation), rate, loop_range — never continuous playback-time mirrors (reverted experiment 6). The UI's displayed time comes back from core status. Seek generations remain the only synchronization token. Scrub pointer events are rAF-coalesced **in the video controls only** (`LayerPanel.svelte`), not via global sync throttles.

## 3. What gets deleted when this lands

`wait_until_buffered` out of every RPC path (arming reports readiness via status instead); the `NativeVideoScrubRequest` map + one-shot exact-decode job queue as a playback mechanism (`decode_native_video_frame_exact_rgba` survives only for thumbnails/offline stills); poster-frame warming; any decoder spawn outside `VideoSession`. Status gains `video_oneshot_decodes_during_playback` — steady-state value must be 0 and the gate asserts it.

## 4. Commit sequence (one change per commit; rebuild release core + 46-test gate + GLSL/JS smoke after EVERY step)

0. **Checkpoint commit** of the restored files only (handoff step 1). Nothing else rides along.
1. **Observability only, no behavior change:** status fields per handoff step 2 (decoder counts/PIDs/generations, ring depth, last-decoded vs last-presented PTS, trigger/scrub latencies, loop-boundary delta, command-loop latency, one-shot-during-playback counter) + a fixture clip with burned-in frame numbers + `scripts/native-video-probe.mjs` that drives place → trigger → seek → 30 s scrub-storm → 100 loop crossings over RPC and prints the metrics. This harness is how every later commit proves itself.
2. **Unblock the command thread:** `prefetch_media` becomes enqueue-only (immediate return with session-state snapshot); delete the `wait_until_buffered` call from the RPC path. Expected: RPC timeouts and the 0–12 FPS collapse disappear *even though video features are still broken*. This is the single highest-value commit.
3. **Introduce `VideoSession`** owning the existing playback stream only (no scrub/loop changes yet): session thread, desired-state slot, generation tagging on the ring, process registry. Playback parity must be bit-identical (probe + goldens).
4. **Scrub rework:** latest-wins scrub via the session; one scrub decoder; nearest-ring-frame immediate feedback; kill the one-shot job path. Gate: 30 s pointer-storm → decoder count never exceeds 2 for the source, zero RPC timeouts, tracked frame within one decode of the pointer.
5. **Resume-from-scrub** at exact final PTS (gate 4 in the handoff acceptance list).
6. **Loop double-buffer**, full clip then trimmed. Gate: 100 crossings, boundary delta exactly one frame period each time.
7. **Arm-on-placement** for instant trigger in Mapping mode (<16 ms), then wire the same arm call into `vjClipLauncher` (VJ stays secondary per the handoff).
8. **Budget/LRU + soak:** five simultaneous 1080p clips, 10 minutes, no decoder growth, no underflow bursts, no RPC timeout; shader/JS smoke still green. This is the handoff's full acceptance run.

## 5. Invariants to assert in tests (not just observe)

- Command-thread latency under scrub-storm: p99 < 2 ms (it does hashmap writes only).
- `video_oneshot_decodes_during_playback == 0` in steady state.
- Ring publish with stale generation → dropped, counted, asserted in the scrub test.
- Decoder registry counts within caps at every probe sample.
- GLSL/JS frame cadence unchanged (±5%) while a video scrub-storm runs — the regression that motivated the rollback, made into a permanent gate.
