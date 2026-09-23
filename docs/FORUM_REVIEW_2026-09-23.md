# Forum review — 23 September 2026

Read all seven topics visible at https://ghostarcade.live/forums, including all replies. No replies were posted and no forum content was changed. Review is against the current local 2.0.10 workspace, including the pending renderer and stage changes, not a claim that the public 2.0.7 installer contains these fixes.

## Findings and changes

| Report | Current finding | Action / acceptance still needed |
| --- | --- | --- |
| [Lines: Edit Points does not move points, Windows 2.0.7](https://ghostarcade.live/forums/thread/23a8c6bf-3657-487c-8af2-f5b7d2954792) | Confirmed code defect. Toolbox Select emitted `select`; App treated every mode except `none` as drawing, bypassing vertex movement. The Edit Points button also bubbled its mouse-down into line selection. | Normalize Select to idle, stop the button from changing selection, and explicitly leave drawing mode when toggling point editing. Regression covers both drawing modes returning to Select. Windows pointer testing remains. |
| [Settings goes permanently black, probably OSC, Windows 2.0.4](https://ghostarcade.live/forums/thread/103b369d-6f0d-4e65-a078-b5e3825d4a02) | Already addressed in current code: per-section error recovery, sidebar stays accessible, failed persisted section cleared, and malformed OSC binding hydration sanitized. | Re-ran Settings boundary and OSC hydration tests. Reproduce with the reporter's old preferences on Windows if symptoms recur; do not delete their user data as a workaround. |
| [Ableton Link phase, beat indicator, quantization](https://ghostarcade.live/forums/thread/7658d94a-3bb6-4685-8d80-87261c8d2da6) | Implemented: tempo, quantum, phase, peers, numbered beat/downbeat monitor, continuous session beat position and quantized triggering. | Re-ran Link and quantization tests. Verify against a second machine running Traktor/Live; unit tests cannot establish network/device alignment. |
| Same topic, reply: blank layers/VJ and Escape does not close fullscreen | Current native core detaches and hides its output window on Escape without stopping the renderer. Blank output overlaps the other media/program reports. | VJ output frame tests pass on Mac. Escape focus behavior and actual Windows output window remain in acceptance. |
| [NDI output missing; interface too small on 4K](https://ghostarcade.live/forums/thread/528699a5-a2e0-412e-8f7a-56f3977ca9f4) | NDI output was difficult to find, and the Screens transport incorrectly used input-addon availability to gate output. No user interface-size control existed. | Added Settings → Output → NDI Output with capability/error status and setup instructions. Screens now checks actual output support and explains full-composition semantics. Start/stop requests are serialized; failures show a toast. Added Settings → App → Appearance → Interface size, persisted 75–200%, with native preview/deck geometry scaling. |
| [MP4 metadata/playhead changes but picture is blank or stale, Windows 2.0.4](https://ghostarcade.live/forums/thread/3c86fa34-08ef-4aa1-aa2c-05b5375b39ff) | Current renderer has native video-session routing, preroll readiness, seek/direction reconciliation and processed-video source binding absent from the reported release. | Native MP4 startup, cadence, effects and VJ handoff tests pass on Mac. Exact Windows file replacement and the user's MP4 still need verification; not marked definitively reproduced/resolved on their system. |
| [Deck images visible, Program/output blank; app missing from Apps](https://ghostarcade.live/forums/thread/faeba765-13a5-4940-b0b4-68a6d64c3579) | Current native composition path has explicit VJ mix presentation, output handoff and screen-carrier tests. Installation report gives no OS or installer type. Windows uses NSIS; Mac DMG includes an Applications shortcut. | Real VJ mix/screen frame tests pass on Mac. Check Program and physical output on Windows. App discovery needs OS/install details; on Mac copy the app from the DMG into Applications. No speculative installer modification. |
| [Live computer/phone camera not recognized in VJ](https://ghostarcade.live/forums/thread/b824fdf2-922e-4eb4-9bd9-3d4f30a4c8c3) | Current VJ webcam path opens native capture and accepts clips without a browser video element. Shared-texture sessions route at live-frame cadence. | Native source-routing and permission tests pass. Physical cameras and phone source type require hands-on verification; the report does not identify how the phone was connected. |

## NDI limitation — still not implemented

Windows composite NDI output remains unsupported. NDI input discovery does not enable output, and installing NDI Tools alone cannot add the missing sender path. Current macOS output requires the optional addon plus runtime and sends one full composition; it does not provide independent per-screen crop/warp senders. The updated controls and [NDI guide](ndi-setup.md) disclose this rather than presenting a working toggle on unsupported builds.

## Verification

- 114 focused tests: line-tool transitions, Settings recovery, OSC hydration, Link tempo/phase, quantization, preview geometry, VJ composition, camera permissions and renderer sync.
- 2 additional interface-scale tests: invalid persisted values and main-editor-only subscription lifetime.
- 27 native GPU runtime tests: MP4 startup/preroll/playback, video effects, scheduled VJ mix and screen handoffs.
- Desktop type/Svelte check: zero errors; existing warnings remain.
- Production frontend build passes.
- Isolated Electron UI check: a Lines point moved after Select → Edit Points; interface size saved at 150%; native preview stayed aligned; NDI Settings reported the absent optional addon accurately. This test used a disposable profile and did not touch the open user project.

## Windows acceptance before release

1. Install the new build; confirm Start menu entry and launch it.
2. Visit every Settings section, especially OSC; close and reopen Settings.
3. At 100%, 125%, 150%, and 200% interface size, check preview alignment, pointer hit-testing, scrolling and menus; move between monitors with different OS scaling.
4. Create a Lines layer, draw freehand and point-click lines, choose Select, enter Edit Points, move/add/remove points, and undo.
5. Load an MP4 on an empty Mapping layer; replace it with a different MP4. Check picture motion and identity, direction, effects and seeking.
6. Trigger media in both VJ decks; inspect deck previews, Program, Stage and physical output. Press Escape with the fullscreen output focused.
7. Add a native webcam source to a VJ cell and play it. Test the intended phone connection separately.
8. Join a Link session on another machine; confirm tempo, 1–2–3–4 phase, downbeat, quantum and quantized launch.
9. Confirm NDI Output explains Windows support accurately and the unsupported transport cannot be enabled. Test Spout separately.
