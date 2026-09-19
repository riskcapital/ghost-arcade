# Parity checkpoint: remaining work — September 19, 2026

This is a development checkpoint, not a release. See RESOLUME_PARITY_STATUS_2026-09-18.md and reports for implementation evidence. Direct image-sequence clips are excluded at Justin's request.

## 1. Windows acceptance of implemented features

- Cold/warm video launches, first picture, trim points, seamless loops, exact frame stepping, mouse/MIDI scrubbing and cue jumps.
- Forward/reverse/bounce: H.264, HAP, HAP Alpha and HAP Q; repeat triggers, interrupted transitions, codec/load stress and correct alpha.
- Layer/clip transitions, all styles, per-clip inheritance, zero-duration cuts, dual decks and mapped Screens.
- Column quantization and cancellation, queued tempo changes, Normal/Toggle/Piano releases, Fader Start, Ignore Column Trigger, layer locks, layer Autopilot and cue persistence on both decks.
- Native clip audio: default-on/mute, volume/pan, layer/master controls, dual-deck crossfade, trim/seek/pause/reverse/bounce/speed, output device switching and unplug/reconnect, long-run A/V sync, packaged FFmpeg.
- Media converter formats/alpha/cancellation and project relink/collect/move/reopen with Windows paths.
- Screen capacity/memory rejection, preview alignment at Windows display scaling, renderer owner-loss cleanup.
- Compact layout, MIDI Learn, typography, focus, popovers and error states in the Windows app.

## 2. Integration and release acceptance

- Physical MIDI feedback on APC40 mkII, APC mini mk2, Launchpad X and Mini mk3; grid paging, queued LEDs, disconnect/held-note cleanup and input-to-picture latency.
- Ableton: actual quantized picture timing, queued tempo changes, long-run end-to-end A/V alignment, DAW audio loopback, physical MIDI clock and multiple-machine/network tests. Mac real-peer native clock soak passed; that is not measured displayed-frame sync.
- OSC test session using the saved Prism Tide Ableton project: triggers/releases, deck addressing, cues, transport, levels, tempo/nudge/resync and custom mappings. Live transport state currently does not automatically start/stop Ghost clips.
- LAN remote: physical phone pairing, authentication/revocation, reconnect and packaged/network checks.
- Signed installed Mac/Windows builds, full-resolution 4K compositions, broader AMD/Intel/Mac GPUs, multiple projectors, device-loss recovery, thermal/storage load and multi-hour shows.
- Visual acceptance of screen-rejection banner. Existing Svelte warnings remain technical debt.
- Commit review, release version/notes, installer qualification and publication. No release tag is part of this checkpoint.

## 3. Playback/media gaps

- Feed native clip audio into recording; match outgoing video transition tails with audio crossfades.
- Native audio clock integration for software-video fallback and consistent Mapping/native audio routing.
- Cold/unprepared long audio positions can remain silent until prepared. Preparation limits and dense-session behavior need qualification.
- Audible scratching, pitch-preserving time stretch, ASIO, channel routing and cue/headphone buses are additional audio scope, not implemented by the initial audio pass.
- Collect external model/playlist dependencies; currently explicitly rejected rather than falsely claimed portable.
- Compatibility decoder short trimmed loops and signed FFmpeg startup latency.
- Avoid rendering a VJ row independently for every mapped Screen; share its rendered feed where appropriate.
- Replace flaky fixed-sleep native tests with observable readiness checks.

## 4. Stage I/O implementation

- Direct native Windows screen windows and deck monitors. The 32-screen core ceiling is implemented; full-resolution multi-projector performance is not qualified.
- Bezier warp and per-screen polygon masks.
- DMX / Art-Net / sACN pixel output, fixture editor, universe spanning, ArtSync and lighting-desk input.
- SMPTE LTC and MTC chase with clip offsets; Pioneer Pro DJ Link and Denon StageLinQ.
- NDI input/output included and validated in both platforms' release builds; settle runtime distribution/licensing.
- 10-bit output and 16-bit composition; Blackmagic DeckLink input and SDI output.

## 5. Platform and creative controls

- Authenticated REST/WebSocket API sharing the MCP tool schema, parameter subscriptions and output snapshots.
- Clip/layer/composition dashboard macros: multiple parameter targets, ranges/inversion and full native effect support.
- Eased envelopes and crossfader/clip position animation sources.
- Real VJ group compositing, group effects/level/blend/column triggering and Screen routing.
- Complete ISF multipass, persistent buffers and live audio/FFT inputs.
- Record individual layers/Screens; alpha clip rendering to HAP Alpha/ProRes 4444.
- User effect-chain presets, .cube LUTs and numeric-field expressions.
- Continue intentional UI/UX review for each feature and compact-window usability.

## 6. Decisions and deliberately excluded work

- Decide NDI redistribution and whether to pursue unofficial Pro DJ Link support.
- After parity acceptance, brainstorm together about new synced/improvised performance workflows before choosing additional features.
- Excluded: direct image-sequence clips, proprietary DXV, a Wire-style node editor, FFGL/VST hosting. Multi-computer frame sync is deferred. The 1.9 line remains fixes-only.
- Separate website carryovers with uncertain status: system-requirements comparison and mobile logo/content positioning. These are not renderer parity blockers.

Prism Tide and its stems are saved locally under scratchpad/ableton-link/Prism Tide Project. They are not included in the source checkpoint; transfer the whole project folder separately for Windows OSC tests.
