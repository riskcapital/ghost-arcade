# Ableton connection validation — 2026-09-19

## Real application checks

Ableton Live 10 Intro 10.1.43 on this Apple Silicon Mac loaded and played the eight-stem Prism Tide set at 92 BPM through CoreAudio / MacBook Pro Speakers, 44.1 kHz, 512-sample buffer. Waveforms and active track/master meters were verified. No missing-media dialog appeared.

- Ghost Arcade joined Live's Link session and displayed its peer and tempo.
- Live → Ghost tempo: 98 BPM reached Ghost.
- Ghost → Live tempo: 88 BPM reached Live. Restored 92 BPM.
- Ghost Link disable/re-enable returned to one peer at 92 BPM.
- Ghost's local nudge/resync controls were disabled while Link owned the clock.
- Live Start Stop Sync was enabled. The independent Link observer recorded both stopped and playing states. Ghost does not currently map these states to automatic clip Play/Stop.
- One-bar beat fit and launch quantization were configured in Ghost. A clip trigger was attempted, but its queued-to-playing transition was not captured before development reload; do not count this as live quantized-launch acceptance.

## Native hardware soak

`nativeAbletonLink.runtime.native.test.ts` passed a 600-second run using a real external Live Link peer, an independent native Link observer and three native VideoToolbox video sessions (forward, reverse, bounce). Session tempo changed between 88, 92 and 98 BPM during the run. Raw data: `ableton-link-live-soak-2026-09-19.json`.

528 settled samples per direction (first 15 seconds and 15 seconds following tempo changes excluded):

| Direction | p95 absolute internal phase error | Maximum settled error |
| --- | --- | --- |
| Forward | 0.926 ms | 2.861 ms |
| Reverse | 0.926 ms | 2.861 ms |
| Bounce | 1.854 ms | 5.718 ms |

These measure native transport clock error against Link-derived targets, not displayed-frame, speaker, or photon-level synchronization. The harness supplies targets independently of Ghost's renderer-side polling. This is not full end-to-end timing acceptance.

## Fix and regression coverage

Prevented the immediate audio-store subscription snapshot from broadcasting an old local tempo when joining Link. Existing session tempo is adopted; later user tempo edits are still broadcast. Added a regression test. Five suites / 28 tests passed covering Link join/continuous beats, launch clock, video beat phase, beat-fit rates and MIDI video scratch mapping.

## Remaining acceptance

- Audio-reactive DAW routing: no configured loopback input; not tested. Link carries clock data, not song audio.
- Physical MIDI clock/controller: no MIDI input/output ports were exposed in Live's preferences; not tested.
- Actual quantized launch boundary observation, queued tempo changes and screen/audio loopback latency remain open.
- Real Windows, multiple machines/network impairment, full-resolution load and packaged builds remain open.

Song deliverables live in `scratchpad/ableton-link/Prism Tide Project/`. No release or commit was made.
