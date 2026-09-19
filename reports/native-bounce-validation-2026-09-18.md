# Native bounce playback — 2026-09-18

Local work on `codex/clip-transitions`; not committed, packaged or released.

## Behavior

Bounce is a third choice beside Loop and Once in the shared VJ and Mapping playback controls. It reflects between the clip's trim points, supports either launch direction and signed speeds, and saves with the clip. The grouped controls retain the existing visual language, with explicit pressed states, keyboard focus and a separate, stable-width current-direction readout. Audio remains silent during bounce; the audio section explains this limitation.

The native worker handles both legs. Forward decoding and the existing bounded reverse window share a continuous presentation timeline. HAP remains compressed through upload; platform video remains on the hardware path. Turning around does not issue a frontend seek or replace the native playback session; decoding seeks stay on its worker thread. Trim-edge portions determine frame hold times. Reverse-window, presentation-queue and opening-cache surfaces remain charged to the shared memory budget.

Direction is retained with the frontend time anchor. Pause/resume and tempo adjustments preserve the current leg; explicit seeks and restarts use the selected launch direction. Exact stepping carries the requested resume direction to the native worker. Autopilot treats one complete out-and-back trip as one loop. Beat-duration fitting uses the same full-trip duration; long-running beat-phase locking remains separate outstanding work.

Library preparation now uses the correct directional launch endpoint, including reverse playback outside Bounce. The broker forwards bounce settings for prepared sessions as well as live commands.

## Validation

- 261 frontend transport, audio, persistence, scrubbing, MIDI, sync and broker tests passed across nine suites.
- 107 Rust tests passed; six opt-in tests remained ignored.
- 39 native GPU playback/transition runtime tests passed; one Windows-only case was skipped on Mac. Bounce cases cover HAP, HAP Alpha, HAP Q and H.264, repeated trim turnarounds, pause/resume, reverse-leg seeks, exclusive-endpoint launches, restart and exact stepping.
- Desktop type checking: zero errors, 1,037 existing warnings. Mobile: zero errors, 52 existing warnings. Production frontend and native release builds passed. Windows cross-compilation passed. Diff whitespace checks passed.
- Mac in-app review passed for shared-control placement and selected states in VJ and Mapping, both live travel directions, pause holding the timeline, and VJ save/reopen restoring Bounce with Reverse 0.25x. The test app was restarted on the final renderer after confirming an empty workspace. The separately saved `scratchpad/clip-transition-test/Bounce_Playback_Test.gha` contains a VJ Bounce clip and a Mapping Bounce layer; it is left open with Mapping paused.

### Short load measurements

The four-stream H.264 test used the 960×540, 30 fps, eight-second Wire Circuit file, whose only keyframe is at the opening. Four independent playback sessions, 512×288 output, 1,024-pixel atlas slots and a 256 MiB decode budget produced 3,848 hardware frames over 32.015 seconds, approximately 30 fps per clip including opening/retrigger frames. There were zero buffer underflows, software frames, hardware fallbacks or CPU pixel uploads. Three four-clip trigger batches were 16 seconds apart, allowing complete out-and-back cycles. See [four-stream result](native-bounce-four-stream-benchmark-2026-09-18.json).

Sixteen distinct 1,920×1,080, 60 fps HAP Alpha files bounced for 12.082 seconds with 1,920×1,080 output, 512-pixel atlas slots and a 1 GiB decode budget. Composition and each session measured 60.004 fps, with zero dropped source frames, underflows, software frames, hardware fallbacks or decode failures. One GPU backpressure attempt was retried. This is not a full-resolution-per-tile or 4K benchmark. See [16-stream HAP Alpha result](native-bounce-hap-alpha-16-stream-benchmark-2026-09-18.json).

## Remaining acceptance

Windows hardware runtime and physical MIDI controller qualification remain open. App inspection was initially blocked by an account usage-limit rejection, then recovered; the Mac visual and interaction checks above were completed afterward. No signed application package or release was made.

Small-fixture runtime checks and short throughput runs are not a guarantee of zero latency, 4K performance or all-night reliability. Bounce audio and long-running beat-phase locking are not implemented.
