# GitHub feedback review — 23 September 2026

Reviewed all 20 issues/pull requests (including closed items), all 16 issue/PR conversation comments, PR reviews, inline review comments and commit comments in `riskcapital/ghost-arcade` before the Windows handoff. The latest conversation comment was September 9; issue #20 was opened September 10. No PR reviews, inline review comments or commit comments were returned. No comments were posted, issues closed or PRs merged.

This review concerns the current 2.0.10 workspace, including pending changes. Older user reports are not considered hardware-verified merely because the relevant implementation now exists.

| Report | Finding and disposition |
| --- | --- |
| [#20 Settings black after OSC](https://github.com/riskcapital/ghost-arcade/issues/20) | Covered by current per-section Settings recovery and sanitized OSC hydration; regression checks passed in the forum review. Windows acceptance remains. |
| [#19 README Discussions 404](https://github.com/riskcapital/ghost-arcade/issues/19) | Confirmed: repository Discussions is disabled. Replaced the broken README link with the community forum. |
| [#18 Composition FX](https://github.com/riskcapital/ghost-arcade/issues/18) | Current native VJ composition route applies composition effects. Covered by the composition and native video-effect checks; verify on Windows. |
| [#17 Dual-deck squeezed output](https://github.com/riskcapital/ghost-arcade/issues/17) | Current routing has dedicated dual-deck layout/transition regression coverage. Include same-row A/B clips in Windows acceptance. |
| [#7 Parameter-path documentation](https://github.com/riskcapital/ghost-arcade/issues/7) | Current Settings has examples, validation and Learn. Added a manual-binding reference to `docs/osc.md`, explicitly distinguishing zero-based parameter paths from one-based OSC template addresses. Website publication is separate and has not been performed here. |
| [#8 OSC aliases and MIDI replay](https://github.com/riskcapital/ghost-arcade/issues/8), [#9 Mapping replay](https://github.com/riskcapital/ghost-arcade/issues/9) | Legacy `vj:layer:0:opacity` normalizes to `vj:0:opacity`. Mapping and VJ restart controls expose MIDI paths. Control-path, MIDI store and scratch tests pass; repeat the reporter's external note/OSC messages on Windows. |
| [#10 GLB textures](https://github.com/riskcapital/ghost-arcade/issues/10) | Native models load diffuse textures; single-texture models are sampled directly, while multiple textures use vertex-color baking. This does not establish fidelity for the reporter's Polycam file. Exact-file verification remains, especially sparse or multi-material models. Model renderer unit tests pass, but do not reproduce that asset. |
| [#3 Lingering processes](https://github.com/riskcapital/ghost-arcade/issues/3), [PR #4](https://github.com/riskcapital/ghost-arcade/pull/4) | Current Electron shutdown includes guarded cleanup and forced-exit fallback. Windows quit/relaunch and process cleanup still require acceptance. |
| [#5 OSC listener](https://github.com/riskcapital/ghost-arcade/issues/5), [PR #6](https://github.com/riskcapital/ghost-arcade/pull/6) | Listener/settings recovery is already represented in the current implementation. Fullscreen/window behavior remains part of Windows acceptance. No older PR was merged over the current implementation. |
| [PR #11 Webcam arming](https://github.com/riskcapital/ghost-arcade/pull/11) | Current native webcam routing accepts live sources without browser video elements. Routing and permissions checks passed; physical-device verification remains. |
| [PR #16 Packaged paths/3D assets](https://github.com/riskcapital/ghost-arcade/pull/16) | Closed; maintainer's September 9 reply confirms integration. No additional merge performed. |
| [#2 First-run feedback](https://github.com/riskcapital/ghost-arcade/issues/2) | Load Demo and the former Preview toolbar option are no longer present. Shader drag directly onto the Mapping canvas is still not established; applying through the selected layer works. Website wording and canvas-drop behavior need a separate follow-up. Old install-time dependency warnings were not addressed by broad dependency changes immediately before platform acceptance. |
| [PR #15 Korean localization](https://github.com/riskcapital/ghost-arcade/pull/15) | Open contribution, superseding closed PRs #13/#14. Requires a separate localization/integration review; not merged as a bug fix. |
| [#12 Hosting-policy request](https://github.com/riskcapital/ghost-arcade/issues/12) | Product/hosting decision, not a playback defect. No change. |

## Additional verification

34 tests passed across control paths, MIDI store, MIDI video scratching and the model renderer. The earlier [forum review](FORUM_REVIEW_2026-09-23.md) records the 143 focused/runtime tests, desktop check, build and isolated UI verification for this handoff.

## Extra Windows acceptance

- Trigger same-row media in both decks; move the crossfader and inspect the complete frame.
- Learn a note to Mapping restart and VJ restart; verify one restart per press.
- Bind an OSC message to `vj:layer:0:opacity`; verify normalized routing and visible opacity changes.
- Quit with media/output active, check that child processes exit, then relaunch immediately.
- Test a textured GLB with the reporter's asset if available. Preserve that file for a reproducible issue if material appearance differs.

Windows composite NDI output remains unsupported; see the forum review and NDI guide. Windows hardware acceptance, the exact Polycam model, canvas-drop follow-up, website publication and localization are not declared complete by this commit.
