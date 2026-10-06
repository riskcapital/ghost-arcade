# Keith McMillen QuNeo

Two ready-made layouts for the QuNeo. Each is a pair of files: a `.quneopreset`
for the QuNeo Editor (what the hardware sends) and a mappings JSON for Ghost
Arcade (what each message does). Keep the pair together — a preset from one
layout with the JSON of the other will not line up.

| Layout | Preset | Mappings | Use it when |
| --- | --- | --- | --- |
| **Perform** (default) | `GhostArcade-Perform.quneopreset` | `ghost-arcade-quneo-perform-mappings.json` | You want decks on faders and no bank switching to think about. |
| **Macros** | `GhostArcade-Macros.quneopreset` | `ghost-arcade-quneo-macros-mappings.json` | You have built macro chains and want all eight on hand. |

## Install

1. **QuNeo Editor** → open the `.quneopreset` → save / update it to a preset
   slot → select that slot **on the device** (the Editor alone is not enough).
2. **Ghost Arcade** → pick the QuNeo as the MIDI input → click **MIDI** (edit
   mode) → **LOAD** in the bottom bar → choose the matching JSON. When switching
   layouts answer **Replace** so the previous layout's rows don't linger.

MIDI channels in the JSON are 0-based: channel 0 = sliders / buttons / rotaries,
channel 1 = pads.

## Perform layout

| Control | Does |
| --- | --- |
| Vertical sliders 1–4 | Deck A layer 1–4 opacity |
| Horizontal sliders 1–4 (top → bottom) | Deck B layer 1–4 opacity |
| Long slider | A/B crossfader |
| Pads, top three rows | Clip grid, 4 layers × 4 columns. Left corner = Deck A, right corner = Deck B. Top-row top corners launch the whole column on that deck; bottom-row bottom corners are snapshots 1–8. |
| Pads, bottom row | Stop that layer: left half Deck A, right half Deck B |
| Left/right button pairs | Blend mode prev / next for layer 1–4 (both decks) |
| Left up/down pair | Media Library tab prev / next |
| Right up/down pair | Media Library item prev / next |
| Left rotary | Media Library browse (turn) |
| Right rotary | Press = load the highlighted item |
| Rhombus | Stop all |
| Transport ● / ■ / ▶ | Record output · Tap tempo · Record the highlighted live source to a clip |

## Macros layout

Same as Perform except:

| Control | Does |
| --- | --- |
| Vertical sliders 1–4 | Layer 1–4 opacity. **Right up/down pair switches the deck**: no LEDs = Deck A, left LED = Deck B (QuNeo slider bank 1 / 2). |
| Horizontal sliders 1–4 | Macros 1–4 |
| Pads, bottom row | Pressure → macros 5–8 |
| Right up/down pair | Slider bank switch (sends no notes, so no item prev / next) |

Macros start empty in Ghost Arcade — right-click a macro knob to add effects, or
pick the macro beside an effect parameter — so this layout only earns its keep
once you have built some.

## Overlay sheet

`GhostArcade-QuNeo-overlay.pdf` — page 1 Perform, page 2 Macros. Print it at
100 % on US letter / A4 landscape and keep it beside the controller.

## Regenerating

Everything is generated; don't edit the outputs by hand.

```bash
cd docs/controllers/quneo
python3 build_quneo_preset.py perform
python3 build_quneo_preset.py macros
python3 build_overlay.py          # the PDF; standard library only
```

`quneo-base.quneopreset` is a stock QuNeo preset used only for the hardware
definitions. The script asserts that no MIDI message is shared by two unrelated
controls. The QuNeo Editor's bank drop-down for up/down pairs is
*Off / For Vertical Sliders / For Long Slider / For Rotaries* (codes 0–3).
A pad's `enableGrid` is 0 for drum mode and 2 for grid mode — the only two
values the base preset uses — so the Perform bottom row sets 2.

## Paths this layout relies on

`vj:<n>:opacity`, `vj:<n>:trigger:<col>`, `vj:column:<col>`, `vj:<n>:stop`,
`vj:<n>:blend:next|prev`, `vj:stopall`, `vj:snapshot:<n>`, `vj:crossfader:value`,
`vj:macro:<n>:value`, `vj:rec`, `vj:tap`, and the `tray:` family (`tray:browse`,
`tray:load`, `tray:prev|next`, `tray:tab:prev|next`, `tray:rec`) — all with
`vj-b:` for Deck B. See `src/lib/control/controlPaths.ts`.
