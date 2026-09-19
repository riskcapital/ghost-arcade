# Native VJ clip audio — September 19, 2026

Implemented locally on `codex/clip-transitions`; not published or committed by this change.

## Playback and controls

Desktop VJ video clips play their audio by default. Saved explicit audio-off choices remain off. Clip volume, stereo balance and mute live with clip playback; layer volume and balance live in the layer gear tray. Audio Out in the integrated deck toolbar selects an output device and controls master volume/mute. Device choice is remembered on this machine. Clip, layer and master controls have MIDI paths; both decks are supported. Layer mute/solo affects audio independently of visual opacity. The A/B crossfader uses equal-power audio gains.

The native mixer derives position and effective rate from the hardware video stream clock, including its beat-phase correction. Pause, trim, loop, reverse, bounce and seek/resume follow that clock. Changing audio enable does not seek the video. Desktop VJ sound no longer needs an audible browser video decoder.

FFmpeg decodes audio only, on two background workers, into progressive 48 kHz stereo float PCM files. A separate worker reads/interpolates/mixes samples into an atomic ring. The CPAL output callback performs no disk I/O or heap allocations and does not acquire the mixing mutex. Output buffering accounts for the device callback size and reported playback latency. Volume/balance changes use a short smoothing ramp; linked stereo peak protection prevents output above unity. This is not a mastering limiter or pitch-preserving time-stretch engine.

## Validation

- Native Rust suite: 113 passed, 6 existing ignored.
- Focused frontend/persistence/MIDI/broker suites: 139 passed.
- Real Mac native GPU/audio test: passed. Encoded H.264/AAC fixture prepared and produced both channels; full-right balance attenuated left; reverse and bounce produced audio with negative transport rate; pause/stop became silent; 1.5x playback resumed. Output callbacks continued with zero additional underrun frames during the one-second steady-playback assertion.
- Desktop check: zero errors, 1038 existing warnings. Native mobile check: zero errors, 52 existing warnings. Production UI build passed.
- Windows native cross-compilation check passed; no physical Windows audio test performed on this Mac.
- In-app isolated Mac profile: loaded a generated quiet-tone project, triggered the clip, saw “Output active · 1 clips prepared,” enumerated MacBook Pro Speakers/NDI Audio, and switched to MacBook Pro Speakers. Stopped the test tone afterward.
- Visual review caught and fixed a clipped output panel: it now uses the native popover layer, constrained to the viewport, with explicit readable foreground color.
- Development watcher now ignores native build outputs, reports, logs and isolated test profiles to avoid repeated reloads while testing.

## Acceptance still open / limits

- Physical Windows output-device switching, packaged FFmpeg availability, long-session A/V sync, dense multi-layer playback and device unplug/reconnect require real-machine acceptance.
- Paused scrubbing is silent. Audio resumes at the new native playhead; audible DJ-style scratch grains are not implemented.
- Preparation is bounded to 64 resident sources, 2 GiB total decoded PCM and 512 MiB per clip (roughly 23 minutes at stereo 48 kHz). Unprepared positions remain silent until decoded; preparation and errors appear in Audio Out. This does not promise instant cold playback at an arbitrary position in a long file.
- Applies to native hardware-backed VJ video playback. Mapping mode/browser fallback retain their existing audio route. Software video fallback has no native clip-audio clock integration.
- Native clip audio is not yet fed into the existing browser recording audio bus. Recording native clip sound remains a separate integration task.
- Audio follows clip switches with its own short control smoothing; outgoing video transition tails do not yet have a matching audio crossfade. Dual-deck crossfading is implemented.
- System stereo output via CPAL/CoreAudio or WASAPI; no ASIO, channel matrix, cue/headphone bus or pitch preservation in this pass.

Direct image-sequence clips are excluded at Justin's request.
