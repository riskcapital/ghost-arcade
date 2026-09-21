# Rendering and UI regression review — 2026-09-21

Scope: recent native composition, clip/layer FX, VJ Mix/Maps/Stage routing, grouped screen feeds, transport startup tests, inspector layout and contextual help. This is a targeted cross-cutting review, not a claim that every application feature or external device has been acceptance-tested. Existing unrelated changes are preserved. Nothing was published or committed by this review.

## Confirmed defects fixed

- **Composition/plugin FX discarded:** the native source graph took precedence over the effect graph. Source generation and post-processing now compose into one ordered graph. Retained mix/crossfade graph signatures include effect changes.
- **Stage slices bypassed FX:** copying the producer's raw source recreated unprocessed video. Slices now sample the completed producer frame, preserving clip/layer/composition FX.
- **Cleared VJ selections became row zero:** numeric coercion treated null as 0. Explicit null guards preserve a layer's own source; missing explicitly selected feeds become blank rather than displaying stale media.
- **Effects leaked between workspaces:** Mapping composition FX could affect ordinary VJ playback, while VJ Maps had no composition pass. Final composition selection now follows the active workspace; Mix uses its own carrier and Stage retains Mapping composition processing.
- **Effect opacity ignored:** native layer/clip graphs forced full wet output and omitted opacity from cache signatures. Opacity now reaches all three graph-building paths, including zero. Six effects with their own wet mix multiply it by master opacity.
- **Escape swallowed by help:** an open tooltip intercepted Escape intended for the focused control. It consumes Escape only when focus is inside the help card.

The preceding composition carrier and inspector fixes are also verified: Mix presents its processed carrier, Mapping composition controls scroll at compact heights, and clip launch settings are labelled as overrides of layer defaults.

## Unsupported controls made explicit

Native per-effect blend modes are not implemented. The two Mapping inspector selectors now display Normal and are disabled with an explanation. Saved values are preserved. Layer blend modes remain supported. This review does not add per-effect blend rendering.

## Verification

- 499 store, routing, media, control, help, OSC, color and graph unit tests passed across 39 files.
- 34 effect and native GPU tests passed across three files on Apple M1 Max/Metal. Pixel assertions cover composition inversion, opacity 0 and 0.25, stage sampling of processed output, and removal of the effect.
- All 11 native video startup/handoff tests passed after correcting the hardware fixture and asynchronous readiness expectations described below.
- 21 Electron contextual-help checks passed, including Escape propagation and documentation navigation.
- Real Svelte Mapping inspector passed at 600px and 420px host heights: all 12 effects remain reachable and the layer list retains usable height.
- Desktop type check: zero errors; 1,038 existing warnings remain. Production build passed with bundle-size warnings.

## Video test corrections and acceptance limits

The original 64x36 H.264 fixture is rejected by VideoToolbox on this Mac with status -12911. The test now uses 320x180 encoded media while retaining small output dimensions. Two tests also conflated prepared-frame submission with asynchronous GPU completion. They retain immediate assertions that all rows handed off prepared frames, and separately require GPU readiness within a bounded one-second test timeout. That timeout is a correctness bound, not an acceptable live-performance latency target or a measured latency guarantee.

Windows/D3D12 acceptance remains necessary, including full-resolution multi-row retriggers, dual-deck transitions, stage slices, composition FX changes during playback, effect opacity automation, MIDI/OSC and external displays. This Mac test run does not certify those combinations or quantify worst-case trigger-to-display latency.
