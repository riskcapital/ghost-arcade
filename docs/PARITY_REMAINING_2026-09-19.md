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
- Qualify the new Auto curves, beat sync and crossfader/clip-position drivers live; complete composition Audio/LFO routing; clip Audio/LFO is implemented with live-input acceptance pending. Mapping and VJ composition Auto are implemented. Dedicated envelope presets remain separate scope.
- Real VJ group compositing, group effects/level/blend/column triggering and Screen routing.
- Complete ISF multipass, persistent buffers and live audio/FFT inputs.
- Record individual layers/Screens; alpha clip rendering to HAP Alpha/ProRes 4444.
- .cube LUTs and expression support in remaining standalone numeric fields. Shared slider/effect readouts now accept arithmetic. User effect-chain presets are implemented; visual acceptance in the desktop app remains.
- Continue intentional UI/UX review for each feature and compact-window usability.

## 6. Decisions and deliberately excluded work

- Decide NDI redistribution and whether to pursue unofficial Pro DJ Link support.
- After parity acceptance, brainstorm together about new synced/improvised performance workflows before choosing additional features.
- Excluded: direct image-sequence clips, proprietary DXV, a Wire-style node editor, FFGL/VST hosting. Multi-computer frame sync is deferred. The 1.9 line remains fixes-only.
- Separate website carryovers with uncertain status: system-requirements comparison and mobile logo/content positioning. These are not renderer parity blockers.

Prism Tide and its stems are saved locally under scratchpad/ableton-link/Prism Tide Project. They are not included in the source checkpoint; transfer the whole project folder separately for Windows OSC tests.

## Effect-chain preset checkpoint

User effect-chain presets are now available through the compact Presets tray in VJ clip/layer/composition FX (both decks) and Mapping layer/composition FX. Save a named chain, add it to the current chain, explicitly replace the chain, or delete a saved preset. Presets preserve order, bypass state, parameters, blend/opacity and parameter automation; applying them creates independent effect identities. Combined clip/layer native pass limits and unsupported native effects prevent unsafe application.

The library is local to this computer. Applied chains use normal project persistence, including active VJ grid cells and blocks. Storage errors are surfaced without publishing a false save; an unreadable stored library is preserved. Preset file import/export is implemented in the follow-up below; automatic library synchronization is not implemented.

Validation: 201 focused preset, project persistence, launcher, transition and native-sync regression tests pass. Desktop type checking passes with zero errors (1038 existing warnings), and whitespace checks pass. No new GPU implementation is involved in this feature. Visual acceptance in the desktop app and Windows UI acceptance remain pending. Changes are local and uncommitted.

## Numeric-expression checkpoint

Shared NumericInput and EffectParamRow typed value readouts now accept +, -, *, /, parentheses, signed decimals and scientific notation (also ×, ÷ and −). Enter or blur commits a valid result through the existing range clamp; Escape cancels. Invalid or nonfinite expressions preserve the current value and show an inline explanation. Enter followed by blur cannot apply twice. Expressions are bounded and parsed directly, without JavaScript evaluation or partial-number parsing.

This covers the panels already using those shared components, including effect, GPU and Pixel FX controls. The shared BPM widget is also migrated (see below). Other standalone number inputs still need migration; this is not app-wide expression parity. Values are stored as computed numbers, not live formulas. Visual acceptance remains pending.

Validation: 35 expression cases and four preset-library regressions pass. Desktop type checking reports zero errors (1038 existing warnings); whitespace checks pass. Changes remain local and uncommitted.

## Tempo-expression follow-up

The shared Mapping/VJ BPM widget now accepts arithmetic expressions, using the existing manual-tempo route and 30–300 BPM clamp. A focused draft is isolated from live BPM updates. Enter and blur commit at most once; Escape restores the live readout; invalid or nonpositive results leave tempo unchanged and show an error. TAP and AUTO clear obsolete edit errors. This does not change Ableton Link's existing clock-priority policy.

Validation: 150 expression, launcher/persistence and native queue regressions pass. Desktop type checking reports zero errors (1038 existing warnings), and whitespace checks pass. Desktop interaction/visual acceptance remains pending. Changes are local and uncommitted.

## Transition-duration expressions

Layer and clip transition duration fields accept arithmetic expressions with the existing 0–10 second clamp. Enter/blur commits once, Escape cancels, malformed/nonfinite results preserve the current duration, and inherited clip durations stay read-only. Editing drafts are discarded when the selected deck/row/clip changes. The continuous duration slider retains its existing behavior.

Validation: 146 expression, transition-store and launcher/persistence regressions pass. Desktop interaction and visual acceptance remain pending; other standalone numeric controls still need migration. Changes remain local and uncommitted.

Final desktop type checking passes with zero errors (1038 existing warnings); whitespace checks pass.

## Portable effect-chain libraries

The Presets tray now includes Import library and Export library for a versioned Ghost Arcade JSON file. Import adds chains with fresh identities, preserves existing presets, and numbers conflicting names. The entire file is validated before one durable save; malformed files, unsupported versions, invalid automation, oversized files and quota failures leave the existing library unchanged. Import does not apply effects to the current show. Transfer is manual; referenced external assets are not bundled.

Validation: 110 library and project/launcher persistence regressions pass, including transfer round trips, collision handling, all-or-nothing rejection and storage failures. Desktop type checking reports zero errors (1038 existing warnings); whitespace checks pass. File-picker/download interaction and Windows visual acceptance remain pending. Changes remain local and uncommitted.

## Extended keyframe easing

Mapping timeline keyframes now offer Sine, Exponential Out, Bounce Out and Elastic Out in both the inspector and right-click menu. The existing step curve is labeled Hold and keeps its saved identifier. Elastic intentionally overshoots; its tooltip explains that behavior. All curves land exactly on endpoint values and retain normal project persistence. The context menu measures its size and remains scrollable within the viewport.

This is timeline easing only. BPM-synced envelope presets and crossfader/clip-position animation sources remain outstanding. Visual acceptance remains pending; changes are local and uncommitted.

Validation: 123 easing and project/launcher persistence tests pass, including project save/reopen with every curve. Desktop type checking passes with zero errors (1038 existing warnings); whitespace checks pass.

## Curved Auto sweeps

The shared modulation tray now includes a Curve selector under Auto. Live loop/ping-pong sweeps use the same easing definitions as timeline keyframes, with linear behavior retained for old projects. Auto clamps shaped progress to the selected endpoints, including elastic peaks, so it respects the user's range. Reversed ranges remain valid. Curve selections are part of AutoConfig and travel with normal effect data and effect-chain preset exports. Hold is omitted from repeating Auto choices because a looping phase would never reach its destination.

This remains a free-running Hz-based Auto control. BPM-synced envelopes, clip-position/crossfader drivers and live hardware acceptance are still outstanding. Changes remain local and uncommitted.

Validation: 143 curve, preset and project/launcher regressions pass. Coverage includes old-project defaults, ping-pong symmetry, bounded elastic movement, reversed ranges and preset transfer with easing. Desktop type checking reports zero errors (1038 existing warnings); whitespace checks pass. Visual/live acceptance remains pending.

## Beat-synced Auto timing

Auto now offers Free or Beat sync timing in the shared modulation tray. The cycle selector spans 1/4 to 32 beats, where one cycle means a full loop or ping-pong round trip. Beat mode reads the shared launch-clock position once per animation tick, preserving the existing manual/audio/Link clock priority and responding to nudge/resync. It does not integrate tempo into an independent accumulating phase. After a frame stall, beat movement catches up to the grid; free movement keeps its previous stall behavior. Pausing holds the value; resuming beat mode rejoins the global grid.

Timing and cycle length are optional AutoConfig fields, so old projects remain free-running and preset files preserve the selection. This is frontend Auto scheduling, not a native deadline guarantee. End-to-end Ableton picture timing, live visual acceptance and clip-position/crossfader drivers remain outstanding. Changes remain local and uncommitted.

Validation: 126 Auto phase, preset and project/launcher regressions pass. Tests cover absolute beat alignment, negative beats, pause/resume, frame stalls, old free-running behavior and preset transfer with timing fields. Final desktop type checking reports zero errors (1038 existing warnings); whitespace checks pass.

## Crossfader parameter driver

Auto's Driver selector now includes Crossfader A/B alongside Free and Beat sync. The crossfader's raw 0–1 position drives the selected parameter range through its easing curve; saved ping-pong mode does not fold this position. Deck A reaches the range start and Deck B the end, including reversed ranges. The engine samples the fader once per tick for all supported Auto targets. Pause or disabling Split Deck holds the last value, and resuming follows the current fader position. Time-only controls are hidden for this driver. Preset files preserve its configuration.

This uses the existing frontend Auto pipeline, not native frame scheduling. Clip-position drivers and live hardware/visual acceptance remain outstanding. Changes remain local and uncommitted.

Validation: 130 Auto, preset and project/launcher regressions pass. New coverage includes fader endpoints, pause/disabled holding, resume, range inversion, bounded inputs and preset transfer. Desktop type checking reports zero errors (1038 existing warnings); whitespace checks pass.

## Clip-position parameter driver

Auto's Driver selector now includes Clip position. For Mapping layer video sources and active VJ row videos, it normalizes the shared native transport snapshot from trim start to trim end, then applies the configured range and easing curve. Reverse, bounce, pause, loop wrapping and scrub/seek anchors use the same transport calculation as playback controls. Saved ping-pong mode does not fold a position driver. Missing/invalid duration, trim or video position holds the prior phase. Unsupported sources have no fabricated timeline. Driver selections transfer in preset libraries.

This is predicted transport position through the existing frontend Auto pipeline, not presented-frame readback or a native GPU modulation guarantee. Live visual/scratch alignment and both-deck hardware acceptance remain pending. Existing Auto target coverage is unchanged; generator sources do not acquire a video playhead. Changes remain local and uncommitted.

Validation: 141 Auto, native transport, preset and project/launcher regressions pass. Coverage includes trimmed loops, reverse, bounce, pause, explicit scrub anchors, invalid-source holding and driver transfer. Desktop type checking reports zero errors (1038 existing warnings); whitespace checks pass.

## Clip-local effect Auto routing — September 20

The VJ Clip FX numeric controls now expose Auto and resolve its sidecar from the active clip's effects rather than the layer effect chain. The engine evaluates clip-local effects on both decks, with the clip's own video position available to the position driver. Configuration is mirrored through the normal grid/block persistence route, and returning to a clip restores its Auto settings. Manual clears the sidecar. The clip surface exposes only Manual/Auto; Audio/LFO routing is not claimed. Composition Auto remains outstanding.

Validation: 136 Auto, preset and project/launcher regressions pass, including both-deck clip configuration, block persistence, re-trigger restoration and clearing without modifying layer effects. Visual/live acceptance remains pending. Changes remain local and uncommitted.

Final desktop type checking passes with zero errors (1038 existing warnings); whitespace checks pass.

## VJ composition Auto — September 20

VJ composition effect parameters now expose Manual/Auto, with Free, Beat sync and Crossfader drivers routed to compositionEffects rather than a selected layer. The engine evaluates this final-mix chain once per tick. Clip position is unavailable because a composition has no single video playhead; an imported clip-position configuration holds without choosing an arbitrary deck. Its tray explains how to select a supported driver. Configuration survives normal project and preset persistence. Mapping composition Auto and composition Audio/LFO routing remain outstanding.

Validation: 137 Auto, preset and project/launcher tests pass. The new engine-tick test verifies free movement, crossfader input, pause, unsupported clip-driver holding, save/reopen and clearing without changing layer effects. Desktop type checking reports zero errors (1038 existing warnings); whitespace checks pass. Live visual acceptance remains pending. Changes remain local and uncommitted.

## Mapping composition Auto — September 20

Mapping composition numeric effect controls now use the shared parameter row with Manual/Auto, arithmetic entry and Free/Beat sync/Crossfader drivers. Sidecars are read and written on mappingComposition.effects rather than a selected layer. The engine evaluates enabled Mapping composition effects, holds their values while the composition is disabled, and preserves Auto settings through project and preset persistence. Clip position is unavailable at composition level. Clip/composition Audio/LFO routing remains separate work.

Validation: 138 Auto, preset and project/launcher tests pass, including real engine ticks for Mapping composition movement, crossfader following, disabled-state holding, save/reopen and clearing. Desktop type checking reports zero errors (1038 existing warnings); whitespace checks pass. Live visual acceptance remains pending. Changes remain local and uncommitted.

## Clip Audio/LFO routing — September 20

VJ clip effect parameters now expose Audio, LFO and Beat alongside Manual/Auto. Their assignments use clip/effect/parameter identity plus deck, and resolve the active row each tick. Moving a clip within its deck preserves the assignment; other clips on the old row and the other deck are not driven. Inactive clips stay dormant. Base value and parameter range are saved with the assignment so project reopen does not capture an already-modulated result as the new center. Manual clears the assignment and baseline; re-enabling captures the current manual value. Composition Audio/LFO remains outstanding.

Validation: 140 routing/Auto/preset/project tests pass. Real modulation-engine tests on both decks cover LFO output, dormant clips, row movement, deck isolation, save/reopen baseline/range persistence and manual re-baselining. Physical audio-input/beat testing and visual acceptance remain pending. Assignments persist with the project, not with the effect-chain library. Changes remain local and uncommitted.

Desktop type checking passes with zero errors (1038 existing warnings); final routing regressions and whitespace checks pass.
