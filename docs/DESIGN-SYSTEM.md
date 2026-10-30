# Design system

One set of rules for every surface: mapping, VJ, the music studio, settings
and the dialogs. The tokens live in `src/lib/theming/system.css`, loaded
after the global skin (`studio-skin.css`) for every theme. The default theme
is Arcade: warm near-black surfaces, warm white ink, one blue for selection.

## Colour

- Surfaces, darkest to lightest: `--ga-void` (app), `--ga-bar` (top bar),
  `--ga-panel` (rails), `--ga-card`, `--ga-sub`, `--ga-raise`, and
  `--ga-slot` for sunken insets (faders, fields, segmented tracks).
- Ink: `--ga-ink-0` primary, `--ga-ink-1` secondary, `--ga-ink-2` labels and
  hints, `--ga-ink-3` disabled. Hairlines: `--ga-line-1/2/3`.
- **Selected is blue.** An active tab, a chosen option, an open tool, a
  selected layer: `--ga-selection-bg`, `--ga-selection-line`,
  `--ga-selection-ink`. Not orange, not purple, not chrome: one blue across
  the app.
- **Primary action is chrome.** The one main action in a panel or dialog
  (Add Files, Create, Save) wears the Arcade ghost-chrome fill. Everything
  else is a plain chip: `--ga-card` with a `--ga-line-2` edge, `--ga-line-3`
  on hover.
- Meaning-bearing colours stay: `--ga-rec` for record and destructive,
  `--ga-live`/`--ga-green` for live output, the deck A/B colours, each
  studio set's face colours.
- No raw hex greys for text or lines in new code; use the ladders.

## Type

One family (the theme's UI face) plus the mono face for numbers that tick
(BPM, timecode, FPS, values that change while you watch).

| Token | Size | Use |
|---|---|---|
| `--ga-text-micro` | 9px | Legends under knobs, count badges |
| `--ga-text-eyebrow` | 10px | Uppercase section labels |
| `--ga-text-meta` | 11px | Hints, secondary text, dense values |
| `--ga-text-control` | 12px | Buttons, fields and tabs inside panels |
| `--ga-text-body` | 13px | Body text, top-bar controls, menu items |
| `--ga-text-title` | 14px | Panel titles, emphasised rows |
| `--ga-text-heading` | 16px | Dialog titles |
| `--ga-text-display` | 20px | Page and modal headers |

Larger display sizes appear only on the welcome screen and loaders. Weights:
500 body, 600 controls, 650–700 titles and eyebrows.

## Casing

- **Sentence case for everything you can press or read as content:**
  buttons, tabs, toggles, menu items, options, values, titles ("Detect
  tempo", "Add files"). Names of places and features keep their capitals:
  Stage Sim, Stage Edit, Map Sim, Split Deck A/B, Media Library.
- **Abbreviations keep their capitals:** FX, BPM, MIDI, DMX, LED, ISF, AI,
  OSC, NDI, A/B, 3D, 2D, MIDI CC.
- **Uppercase only through the eyebrow style**, in the UI face (`.ga-eyebrow`, or the same
  four properties): 10px, weight 700, tracking 0.08em, `--ga-ink-2`. Used
  for section labels in panels and for faceplate legends under knobs
  (those may use 9px). Never on buttons, tabs, values or body text.

Spelling is American ("Color", "Center"). Labels say what a control does,
without leading emoji or glyph decorations; icons are SVG.

## Sizes and spacing

- **Top bar:** 48px tall in every mode (`--ga-bar-h`), controls 30px
  (`--ga-bar-control-h`), 6px between controls in a group, 14px between
  groups. Text 13px, weight 600.
- **Inside panels:** controls 26px (`--ga-control-h`), compact rows 22px
  (`--ga-control-h-sm`).
- **Spacing:** 4, 6, 8, 12, 16, 24 (`--ga-space-1` to `--ga-space-6`).
- **Corners:** `--ga-r-hard` for chips, fields and segmented tracks;
  `--ga-r-soft` for primary actions and the mode switch; `--ga-r-tile` for
  thumbnails.

## Shared pieces

- **Mode switch** (`.ga-mode-switch`): Mapping | VJ at the right end of the
  top bar in both modes, so changing mode always happens in the same spot.
- **Segmented control** (`.ga-segmented`): Mix / Stage / Map in VJ and any
  other one-of-few choice; the active segment uses the selection colours.
- **Eyebrow** (`.ga-eyebrow`): see Casing.

## Top bar order

The same order in both modes, grouped by job:

1. Logo, File.
2. Output: Output Window and Fullscreen (VJ: master level and kill).
3. Places: Stage Sim, Stage Edit, Map Sim, Interactive.
4. Live controls: blackout, test grid, freeze, audio, tempo (VJ: the
   macro knobs).
5. Capture: screenshot, record.
6. Settings, then the mode switch, then mobile and window controls.

## Keep working

The guided tour finds controls by class and title (`.map-sim-btn`,
`.toolbar-center .output-btn`, `button[title^="Edit live 2D stage"]`,
`.bpm-tap-widget`, `.ab-toggle-btn`, `.audio-input-picker` and others in
`GuidedTour.svelte`), and MIDI learn by `data-midi-*` attributes. Restyle and
move freely; keep those hooks.
