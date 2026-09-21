# Windows testing checkpoint — September 20, 2026

Branch: `codex/clip-transitions`. This is a source testing checkpoint, not a published website release or signed installer qualification. Use a copy of a show project and keep the original backup.

## Get the checkpoint

In the existing Windows checkout, finish or preserve any local edits before switching branches. Pull without resetting local work:

```powershell
git fetch origin
git switch codex/clip-transitions
git pull --ff-only origin codex/clip-transitions
npm ci
npm run desktop:native
```

If Git reports divergence or local changes, stop and resolve that rather than forcing the pull. `desktop:native` rebuilds the Windows native core before starting the app; an old renderer executable will not contain this checkpoint's LUT support and render-order fixes. Keep the native build output, especially any DXC/FFmpeg warnings. Record `git log -1 --oneline` with test results.

## What is ready to test

- Native 3D `.cube` LUT loading, replacement, removal, strength, project/preset persistence and GPU residency.
- Existing top-row macros: multi-parameter assignments, per-target start/end ranges and inversion, full native output FX, MIDI control and saved assignments.
- VJ Groups in the deck toolbar: adjacent-row membership, combined level/blend, FX chains, group-only column launches, project persistence and MIDI targets.
- Screen layers as slices in one stage composition: VJ Mix, row or group feed selection; multiple slices can share a group texture. No extra output window is created by changing a slice's source.
- Composition effect modulation and the earlier effect preset/expression/control changes included on this branch.

Groups span both decks after each row's A/B crossfade. They are not independent A/B group banks. Mix/Stage grouping and Maps preset mode are distinct paths. The existing eight top-row macro knobs remain the single dashboard.

## Acceptance checklist

Mark each item PASS / FAIL / NOT TESTED. Capture exact steps and a short screen recording for failures.

### 1. Playback and responsiveness — test first

- [ ] Cold and repeated triggers: H.264, HAP, HAP Alpha, HAP Q; no green first frame, stale picture, long stall or crash.
- [ ] Four active layers, then the heaviest realistic show: repeated triggers during FX changes and group fader moves.
- [ ] Forward/reverse/bounce, trim loops, frame stepping, cue jumps and rapid mouse/MIDI scratching.
- [ ] Clip/layer transitions: zero-duration cut, long fade, interrupted fade and repeated trigger of the same clip.
- [ ] Dual deck crossfade: A, midpoint, B; compare ungrouped and grouped output. No missing row, doubled image or stale frame.
- [ ] Native clip audio playback: mute, volume/pan, deck crossfade, seek/trim/pause/speed, output-device change and reconnect. Recording audio is not implemented in this checkpoint.

### 2. Macros and effects

- [ ] Assign one existing top-row knob to multiple clip/layer/composition effect parameters. Check ranges, inversion and zero/full positions.
- [ ] Switch selected clips and decks: assignments continue controlling their original targets.
- [ ] Assign the same parameter to another macro: the first macro no longer drives it.
- [ ] Switch a parameter to Audio/LFO/Beat/Auto: its macro assignment is removed. Check composition modulation with actual input audio.
- [ ] Add blur to a macro effect bundle: it works, and returning its knob to zero removes the effect.
- [ ] MIDI Learn: macro knob, group level, group FX mix/numeric parameter and A/B group column buttons.
- [ ] Save/reopen; inspect macro assignments, effect values and names. Missing targets remain identified and do not control a replacement clip accidentally.
- [ ] Import a valid LUT, adjust strength, replace/remove it, save/reopen and use it in an effect-chain preset. An invalid replacement must preserve the working LUT and show an error.

### 3. VJ groups

- [ ] Create two non-overlapping adjacent-row groups. Overlapping ranges are unavailable.
- [ ] Fade one group from 100% through 25% to 0%; all children behave as one composite. Return to 100% without a new video launch.
- [ ] Add blur/invert/LUT to the group; adjust mix, bypass, reorder and remove. FX apply to the combined group.
- [ ] Trigger a column inside one group: other layers/deck stay unchanged. Locked and Ignore Column Trigger rows are respected.
- [ ] Queue launches in two disjoint groups; both remain queued. Press one again to cancel only that group. Test full-column replacement as well.
- [ ] Delete a group with a queued launch: its pending launch disappears. Ungrouping retains clips.
- [ ] Remove a layer above/inside a group and save/reopen: membership remains correct.

### 4. Stage slices — one composition, one physical output

Use the existing VJ Stage/Screen workflow. Keep one output canvas and arrange several Screen layers inside it.

- [ ] Assign two slices to the same group and another to VJ Mix or a row. Their content remains independently selectable within the same output.
- [ ] Change the shared group: both assigned slices update, with no one-frame stale flash or unexpected brightness reduction.
- [ ] Warp/crop/mask each slice differently; changing its source preserves the geometry and existing mask.
- [ ] Check translucent media and partial group opacity over black and other content; 25% should not become disproportionately dark.
- [ ] Switch group → layer → Mix; no stale group binding remains.
- [ ] Save/reopen with the same stage layout. Delete an assigned group: that slice goes blank and shows an unavailable assignment, rather than displaying another feed.
- [ ] No extra physical output/window is created by adding a group or assigning a slice's source.

### 5. Endurance and integration

- [ ] Actual projector/output resolution and Windows display scaling: preview/output alignment, resize and fullscreen.
- [ ] Sustain the heaviest representative show for at least 30–60 minutes; capture FPS/dropped frames, GPU memory and any recurring stutter. Longer show qualification still follows.
- [ ] Controller disconnect/reconnect and rapid knob movement; no stuck notes or unexpected group launches.
- [ ] Ableton/OSC tests using the saved Prism Tide project when available. Transfer that whole Ableton folder separately; it is not in Git.
- [ ] Save, quit, relaunch, reopen, relink moved media; repeat the key stage and group checks.

## Deliberately unfinished selected work

Do not spend time looking for these controls in this checkpoint:

- Native clip audio inside recordings; audio tails/fades matched to video transitions.
- Individual layer/Screen recording and HAP Alpha / ProRes 4444 alpha export.
- Direct native Windows output/deck windows.
- Bezier warp, new per-Screen polygon masking and Erase/Restore paint masks (size/softness/opacity, undo/redo, persistence).
- Broader shared-feed optimization beyond the implemented group-to-slice path; dense group changes still need performance qualification.
- Non-effect macro targets; group FX automation and remaining MIDI controls/feedback.
- Signed installer/release qualification and multi-hour, multi-GPU acceptance.

Image-sequence import remains excluded. Separate scoped macro knob banks are not planned. MadMapper parity research follows this selected audit/work, rather than being included in this checkpoint.

## Report a failure

Include: checkpoint hash; Windows version; GPU/driver; output resolution and refresh rate; media codec/resolution/FPS; active layers/groups/slices; exact steps; expected vs actual result; whether it happens cold, warm or only after sustained use; and relevant logs/video. Mark crashes, output corruption and trigger stalls first.

## Automated evidence

Before handoff: 264 focused TypeScript tests pass; 27 native/effect tests pass (including real Mac GPU checks); 127 Rust tests pass with 6 ignored; Windows cross-compilation passes. Desktop checking reports zero errors and 1038 existing warnings. The production build passes. None of these results substitutes for Windows GPU or physical-controller acceptance.
