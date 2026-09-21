# Parity checkpoint: remaining work — September 19, 2026

This is a development checkpoint, not a release. See RESOLUME_PARITY_STATUS_2026-09-18.md and reports for implementation evidence. Direct image-sequence clips are excluded at Justin's request.

## Windows handoff — September 20

Feature work is paused for Windows acceptance. Use [the Windows acceptance checklist](WINDOWS_ACCEPTANCE_2026-09-20.md) for the current testable scope and intentionally unfinished items. Later dated checkpoints below supersede earlier implementation notes; earlier "not yet connected" and "uncommitted" statements describe those historical steps, not the final handoff. This is a source checkpoint, not a website/installer release.

## Approved implementation scope — September 20

Justin selected items 1, 2, 7, 8, 14, 15 and 28 from the decision list, plus Windows acceptance. Projection mapping is central, so 16–18 are included:

- Dashboard macros: multiple parameter destinations, ranges/inversion, clip/layer/composition scope and full native effects.
- Real VJ groups: compositing, effects, level/blend, column triggering and Screen routing.
- Native clip audio in recordings and audio fades matching video transitions.
- Individual layer/Screen recording and alpha export (HAP Alpha / ProRes 4444).
- Shared rendered VJ feeds across mapped Screens.
- Direct native Windows output/deck windows, Bezier warping and per-Screen polygon masks.
- Mapping mask brush: non-destructive Erase/Restore, size/softness/opacity, undo/redo, clear/invert, mask overlay and project persistence; combine with polygon masks and keep painting responsive through GPU-resident masks.
- Windows hardware acceptance of the selected and previously implemented features.

Other open items below remain deferred unless separately selected. Follow this selected work and audit with MadMapper parity research, then choose additions together. Cross-compilation is not Windows hardware acceptance.

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
- Qualify the new Auto curves, beat sync and crossfader/clip-position drivers live; qualify clip/composition Audio/LFO/Beat routing with live inputs. These routes are implemented. Mapping and VJ composition Auto are implemented. Dedicated envelope presets remain separate scope.
- Real VJ group compositing, group effects/level/blend/column triggering and Screen routing.
- Complete ISF multipass, persistent buffers and live audio/FFT inputs.
- Record individual layers/Screens; alpha clip rendering to HAP Alpha/ProRes 4444.
- Expression support in remaining standalone numeric fields. Shared slider/effect readouts now accept arithmetic. User effect-chain presets and native 3D .cube LUT import are implemented; Windows GPU/live-show acceptance remains.
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

## Composition Audio/LFO/Beat routing — September 20

Mapping and VJ composition effect parameters now expose Audio/LFO/Beat through dedicated composition keys, independent of selected rows and decks. Each assignment saves its base value and range. The engine checks that its target effect exists before writing, and disabled Mapping compositions hold their values. Manual removes the assignment; switching to Auto uses the same mutual-exclusion path as other parameter controls.

Validation: 141 modulation, Auto, preset and project tests pass. Real engine tests cover independent Mapping/VJ output even with identical effect IDs, Mapping disable/hold, save/reopen of distinct baselines and manual removal without changing layer effects. Live audio/beat input and visual acceptance remain pending. The preceding controls checkpoint is committed as d3993b27; this follow-up remains uncommitted.

Final desktop type checking passes with zero errors (1038 existing warnings); whitespace checks pass.

## 3D .cube LUT rendering foundation — September 20

Added a bounded standalone 3D Cube parser and native GPU LUT graph. The parser accepts sizes 2–65, quoted titles, comments, decimal/exponent values, per-channel DOMAIN_MIN/MAX and standalone LUT_3D_INPUT_RANGE. It rejects truncated/extra rows, invalid numeric values, duplicate/unknown headers, degenerate float32 domains, ambiguous domain headers and unsupported 1D/combined shapers. Inputs are immutable after validation. Format reference: [Adobe Cube LUT specification 1.0 (mirror)](https://kono.phpage.fr/images/a/a1/Adobe-cube-lut-specification-1.0.pdf).

The dedicated WGSL pass uses an RGBA-aligned GPU storage table, red-fastest addressing, trilinear interpolation, clamped input-domain sampling, adjustable strength and unchanged source alpha. It does not infer camera profiles or perform automatic color-space conversion. Table initialization is separate from the 48-byte strength/domain uniform payload; integration must install the table only when the LUT changes, rather than resending it every frame.

Validation: 27 parser/packing tests pass. A standalone real Metal render-core test checks actual output pixels for identity, channel permutation, interpolation, zero/partial/full strength, per-channel domains, boundary clamping, composited fractional/zero alpha and the largest 65³ table. Desktop checking reports zero errors (1038 existing warnings). No running app restart or Windows hardware test was performed.

**Foundation checkpoint, superseded by the integration below:** the parser/shader initially shipped without picker or persistence integration.


## Color LUT import and native effect integration — September 20

Finished the 3D LUT feature. In clip, layer or composition Effects, add **Color LUT**, then **Load .cube**. The compact control shows the title and table dimensions, supports Replace/Remove, and retains the previous look if parsing fails. Import parsing runs in a worker; changing the selected target or closing the control cancels late results. Strength uses the shared numeric/Auto/Audio/LFO/Beat/MIDI control path. Unloaded/removed LUTs bypass grading, including out-of-range color inputs.

LUT data is embedded in `.gha` projects and effect-chain presets, so reopening or transferring does not depend on the original file path. Both decks, clip and layer chains, VJ composition and Mapping layer/composition persistence are covered. Preset transfer limits now allow 32 MB; the browser's local preset-storage quota still applies and failed saves preserve the existing library. This is standalone 3D Cube support (sizes 2–65), not 1D/combined shaper support or automatic camera color management.

Native chains use a dedicated LUT shader and GPU storage table. Large tables are cached as binary float32 uploads, kept out of live descriptors, and omitted from subsequent acknowledged submissions. Queued graphs install the table before acknowledgment so coalescing cannot discard its only upload. Retained jobs contain no table payload. Cache clears, restarts and failed submissions invalidate frontend residency, and missing LUT resources fail explicitly rather than allocating black tables. The LUT pipeline is warmed with an identity table during startup. Mapping composition routing checks the running core's advertised effects for compatibility.

Validation: 224 focused parser/asset/routing/preset/project/residency tests passed; 26 native/effect-chain tests passed, including real Metal pixel checks, a 65³ table, reference-only queued updates, coalescing, cache recovery and post-composite grading. 127 Rust tests passed (6 ignored), Windows cross-compilation passed, and desktop checking reports zero errors with 1038 existing warnings. The actual Svelte control was checked in an isolated browser preview for layout, successful worker import, invalid replacement preserving the active look, and removal. The production build passes and includes the import worker. Full live-app/Windows GPU acceptance remains pending; the running app was not restarted. Changes remain local and uncommitted.

## Selected scope: native macro effects foundation

Global macro effect bundles now use the full post-composite GPU chain instead of the nine inline color operations. Mapping composition effects run first, then active macro bundles in knob order; each effect's mix is its opacity multiplied by the macro value. Macro-only chains work with Mapping composition disabled. Closing all knobs explicitly clears the retained graph when no composition effects remain, and the legacy inline chain is cleared to prevent double application.

The macro editor includes Color LUT loading and a visible shared output-chain capacity warning. The existing 16-pass output limit applies across Mapping composition and active macro effects. This completes the native effect-route foundation only: multi-target dashboard parameter assignments, ranges/inversion and per-scope dashboards remain open. Other approved scope items above remain open; no Windows hardware acceptance is claimed.

Validation: 64 native-sync regression tests and the real Mac GPU post-composite chain test pass. Desktop checking passes with zero errors (1038 existing warnings); the production build and whitespace check pass. Changes are uncommitted.

## Selected scope: multi-target effect parameter assignments

The eight existing performance macros can now drive multiple effect parameters across Mapping layers/composition and VJ clips/layers/composition. Use the Macro selector beside a shared effect parameter, then right-click the macro knob to edit each assignment's Start/End range, invert it, or remove it. Assigning clears that parameter's Audio/LFO/Beat/Auto route; choosing a modulation source removes its macro assignment. One macro owns a parameter at a time. Mouse, MIDI, auto-pulse and snapshot knob recall use the same dispatch path.

Routes use effect/clip identities and explicit deck addressing, including inactive block clips. Missing targets remain dormant. Assignments persist in project saves; legacy destinations remain opaque and preserved. This extends the existing global eight-knob dashboard. Non-effect parameter assignments remain open; the placement clarification below supersedes the earlier proposal for independent knob banks. Visual and physical MIDI/Windows acceptance remain pending.

Validation: 180 focused routing, persistence and native-sync tests pass. Desktop checking has zero errors (1038 existing warnings), and the production build passes. Changes remain local and uncommitted.


## Macro dashboard placement clarification

Keep the existing eight macro knobs at the top as the single performance dashboard. Clip/layer/composition refers to assignment targets, not additional knob banks. Separate scoped dashboard banks are no longer planned. Existing knobs now count parameter assignments alongside bundled effects, expose keyboard adjustment (arrows, Shift for fine adjustment, Home/End), and identify unavailable targets in their editor while retaining the saved route. Inactive clips in other blocks remain valid targets. Erase/Restore masking stays in the approved mapping scope.

Validation for the placement follow-up: 116 assignment/persistence tests pass; desktop checking passes with zero errors. Windows and visual acceptance remain pending.

## Selected scope: true VJ group GPU foundation

Added a native group graph builder that combines child frames using their own levels/blends, applies the group effect chain to that combined texture, and returns one source row with group opacity/blend for the parent mixer. Group level is never multiplied into individual children. Fading to zero preserves the graph, separate groups use isolated intermediates, and invalid self-feedback/empty groups/over-limit effect chains are rejected explicitly. Pass ordering is assigned across the combined child/effect graph.

This is a renderer foundation, not an exposed group feature: the live Canvas/store/UI, persistence, column triggering and Screen routing are not yet connected. The existing Mapping group flattening path is unchanged. Next step is integrating group identities and ordered membership into the VJ stack without changing ungrouped playback or double-applying composition FX.

Validation: ten group/mixer tests pass; two real Mac GPU tests pass, including a pixel assertion that opaque child composition followed by inversion and 25% group opacity produces quarter-strength magenta over black. Windows hardware acceptance remains pending. Changes are uncommitted.

## Selected scope: VJ group membership and live mixing

A compact Groups tray in the deck toolbar now creates non-overlapping contiguous layer ranges, names groups, adjusts group level/blend, and ungroups without deleting clips. Groups are global post-deck-crossfade ranges (shared by A/B), not independent per-deck group banks. Mix and Stage modes use the native grouped mix; Maps preset mode remains separate. Deleting rows adjusts membership, and project export/import preserves groups.

Canvas tags post-crossfade rows by group identity, hides the individual output carriers while groups are active, and presents the resulting mix once. The native route installs one dependency-ordered graph for child mixes, group effects and the final mix. Unchanged grouped graphs stay resident; changes reinstall the graph. The final VJ Mix feed includes groups, so Screens already assigned to VJ Mix receive them.

Remaining group work: dedicated group FX editing, group-only column triggers, individual group-to-Screen selection, MIDI mapping, performance qualification during dense grouped fader changes, and live Mac/Windows visual acceptance. This does not complete group parity. The normal ungrouped path is retained.

Validation: 185 focused tests pass across group membership, grouped graphs, project persistence and native sync. Two real Mac GPU tests pass, including the exact grouped graph builder now used by the live route. Changes are uncommitted.

## Selected scope: group FX editing and scoped column launches

Each group now has an Effects disclosure in the Groups tray: shared effect picker, bypass, order controls, remove, per-effect mix and shared numeric parameter controls (including expressions), categorical/color controls and Color LUT loading. New effects receive catalog defaults and independent IDs. Adding a selection that exceeds 16 enabled passes is rejected atomically with an inline explanation; imported/reenabled oversized chains retain the existing visible pass-limit warning. Group FX edits persist with the group. Parameter automation/MIDI assignment for group FX remains separate work.

Numbered group launch buttons address the displayed selected deck and launch only that group's eligible rows through the existing immediate/quantized column transaction. Layer locks and Ignore Column Trigger still apply. Disjoint group queues coexist, repeated presses cancel their own launch, overlapping/full-column launches replace conflicting queues, and removing a group cancels its queued launch.

Validation: 197 tests pass covering group FX persistence/mutations/limits, group launch isolation/cancellation, native routing and launch clocks. The older Link test fixture was updated to provide the current beatNow API and a controlled/resynced clock; product clock behavior was not changed. Desktop checking passes with zero errors (1038 existing warnings). Individual group-to-Screen selection, MIDI mapping and live Mac/Windows acceptance remain open. Changes are uncommitted.

## Stage slice group feeds and MIDI controls

Screens remain mapped slices in the existing stage composition, not physical outputs. The Screen layer's Slice source selector now offers VJ Mix, individual VJ layers and VJ groups. Selecting a group preserves the slice's geometry/crop/mask and physical-output configuration. The group is rendered once by the shared VJ mix producer; each slice samples its group texture and applies the group's level. Group blend applies against the VJ stack, while isolated group feeds use normal source blending before the slice's own blend. No output window or display is created by a source assignment.

Group source IDs persist with Screen layers. Switching to a layer or Mix clears the group assignment; deleting a group retains an unavailable assignment and hides the resolved slice rather than showing a different live feed. Native frame ordering now explicitly runs the shared producer before mapped mix readers.

MIDI Learn targets now cover group level, group column launch buttons (explicit A/B deck paths), effect mix and numeric effect parameters. Stable group/effect identities are used. The dispatcher handles normalized parameter-path casing and ignores missing groups/unknown parameters. Group blend, categorical/color parameters and hardware feedback remain additional MIDI coverage.

The two-slice GPU test exposed and fixed repeated alpha multiplication in the VJ mixer over transparent destinations. The mixer now uses premultiplied source-over with blend contributions weighted by destination coverage. This preserves quarter-strength groups as 25%, not 6.25%, without changing opaque-destination blend behavior.

Validation: 192 focused persistence/routing/control-path/group tests pass. Eight mixer/GPU tests pass, including two real Mac GPU tests and two mapped half-frame slices sharing one group producer in one output. The native frame-order test, Mac native build, Windows cross-compilation, desktop checks (zero errors) and production build pass. Real stage UI and Windows GPU/MIDI hardware acceptance remain pending. Changes are uncommitted.

## Final Windows checkpoint verification

The handoff rerun passes: 264 focused TypeScript regressions, 27 native/effect tests including Mac GPU checks, 127 Rust tests (6 ignored), Windows cross-compilation, desktop checking (zero errors; 1038 existing warnings), production build and whitespace checks. Feature work is paused for Windows acceptance; follow WINDOWS_ACCEPTANCE_2026-09-20.md. No version bump, website deployment or release tag is included.
