# UI typography and playback controls audit

## Scope and findings

The baseline source inventory covers all 137 Svelte/CSS files under `src`, including 1,847 font-size declarations. The accompanying `ui-typography-inventory-2026-09-18.json` records file, line, property and value before the shared theme refinements. Reproduce the inventory with `node scripts/audit-ui-typography.mjs --output=<path>`.

This is a complete source declaration inventory, not a claim that every panel, viewport and computed style has been visually certified. The Mac Mapping and VJ playback controls were inspected in the running app.

- Sizes are heavily duplicated: 12px (439), 11px (434), 13px (257), 10px (220), and 9px (91). Small values need role-specific review: a timeline tick and a primary control should not receive the same treatment.
- The shared skin still compensated for a previous Genos font although the UI uses Satoshi. That enlarged ordinary controls inconsistently.
- Section/property labels mixed monospace and UI typography without a consistent hierarchy.
- The VJ launch options relied on inherited label sizes. The transition card had inconsistent field sizing and spacing.
- Hardcoded styles and legacy `!important` rules remain. Shared tokens reduce inconsistency, but individual panel cleanup remains necessary.
- Satoshi is self-hosted; the existing Geist/Geist Mono stylesheet has a remote font dependency. Offline typography and fallback metrics remain an audit follow-up.

## Applied design system

| Role | Standard |
| --- | --- |
| Body | 13px UI font |
| Controls and property labels | 12px |
| Captions and section labels | 11px |
| Titles | 14px |
| Regular / strong weight | 500 / 650 |
| Control / tile / card corners | 5px / 7px / 8px |
| Selected surface / border / text | #172a5b / #3d59b8 / #e0e8ff |
| Keyboard focus | #7996ff |

Shared tab selections, form fields, checkbox selections, helper text and playback controls now use this hierarchy. Numeric readouts use tabular figures. Artwork/output geometry and semantic transport/warning colors retain their purpose.

The Layer launch options now use compact, aligned rows. Transition controls have consistent field heights, spacing, label hierarchy and gently rounded corners.

## Playback interaction

Mapping and VJ now expose separate Forward/Reverse buttons. Speed is an unsigned magnitude; changing speed preserves direction. Direction changes preserve BPM fitting, and subsequent tempo updates preserve the selected sign. In Bounce mode the control is labeled Launch direction, distinct from the live travel-direction readout.

## Validation

- Desktop and native-mobile checks: zero errors; existing warning totals 1,037 and 52 respectively.
- Four focused transport, persistence, scrubbing and native-sync suites: 174 tests passed. The persistence suite then passed all 94 tests after adding reverse/BPM regression coverage.
- Mac UI: Mapping Reverse retained its selection when speed changed to 0.5x. VJ Forward/Reverse toggled independently of the 0.25x speed setting. Layer/transition and playback styling inspected in the native desktop app.
- Production build passed.

## Remaining visual review priorities

1. Media browser, Mapping properties and VJ secondary panels: replace primary-control 8–10px labels where present, check truncation and panel resizing, and consolidate competing scoped rules.
2. Settings and dialogs: consistent field groups, disclosure hierarchy, keyboard focus and error placement.
3. SynthVision, Stage designers, Director, timeline and macros: role-specific density review; retain intentional canvas and ruler typography.
4. Mobile and standalone layouts: touch sizing, small-screen wrapping and matching hierarchy without forcing desktop density.
5. Offline font loading and both themes at multiple display scales.

After Resolume parity acceptance, brainstorm new workflows with Justin before implementing speculative features. The roadmap records both audio-synced and improvised performance as design targets.
