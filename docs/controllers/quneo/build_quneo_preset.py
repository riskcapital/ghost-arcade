"""Build the Ghost Arcade QuNeo preset + mapping file.

`quneo-base.quneopreset` is a stock QuNeo preset used only for the hardware side
(which sensors exist, their default channels / note and CC numbers); every
Ghost Arcade assignment is made explicitly below.

Two variants, chosen on the command line (run from this directory):

    python3 build_quneo_preset.py perform   (default)
    python3 build_quneo_preset.py macros

perform — no macros, no bank switching anywhere:
    vertical sliders = Deck A layer opacity, horizontal sliders = Deck B layer
    opacity, both up/down pairs are library nav, bottom pad row = per-layer stop.
macros  — vertical sliders = layer opacity with the RIGHT up/down pair as the
    Deck A / Deck B slider-bank switch, horizontal sliders = macros 1-4, bottom
    pad row pressure = macros 5-8. Item prev/next buttons are sacrificed.

Outputs are written next to this script as GhostArcade-<Variant>.quneopreset and
ghost-arcade-quneo-<variant>-mappings.json.
"""
import json, copy, sys, uuid

VARIANT = (sys.argv[1] if len(sys.argv) > 1 else 'perform').lower()
assert VARIANT in ('perform', 'macros'), VARIANT

src = json.load(open('quneo-base.quneopreset'))
p = copy.deepcopy(src); cs = p['ComponentSettings']
p['presetName'] = f'Ghost Arcade {VARIANT.title()}'

CH1, CH2 = 0, 1          # QuNeo / MIDI channels (0-based): ch1 controls, ch2 pads
maps = []                # Ghost Arcade MidiMapping objects
def m(ch, typ, num, path, label, mode='absolute', mn=0, mx=1):
    maps.append(dict(id=str(uuid.uuid5(uuid.NAMESPACE_URL, f'{ch}:{typ}:{num}:{path}')),
        channel=ch, type=typ, number=num, path=path, min=mn, max=mx, step=0, mode=mode, label=label))
def btn(ch, note, path, label): m(ch, 'note', note, path, label, mode='toggle')

# ---- Vertical sliders: bank 1 = CC1-4.
for i in range(4):
    v = cs['VSliders'][f'VSlider{i}']; assert v['vB1outLocation'] == i + 1
    m(CH1, 'cc', i + 1, f'vj:{i}:opacity', f'A L{i+1} opacity')
if VARIANT == 'macros':
    # Bank 2 (CC24-27) = Deck B opacity; the right up/down pair switches banks,
    # bank 2 shows as that pair's LEFT LED lit. (CC20-23 would collide with
    # CC21 = bottom-pad 4 pressure -> macro 8.)
    VSLIDER_B2_CC = 24
    for i in range(4):
        v = cs['VSliders'][f'VSlider{i}']
        v['vB2outLocation'] = VSLIDER_B2_CC + i; v['vB2Channel'] = CH1
        m(CH1, 'cc', VSLIDER_B2_CC + i, f'vj-b:{i}:opacity', f'B L{i+1} opacity (slider bank 2)')

# ---- Horizontal sliders: CC11,10,9,8 (top->bottom).
for i in range(4):
    cc = cs['HSliders'][f'HSlider{i}']['hB1outLocation']
    if VARIANT == 'perform':
        m(CH1, 'cc', cc, f'vj-b:{i}:opacity', f'B L{i+1} opacity')
    else:
        m(CH1, 'cc', cc, f'vj:macro:{i+1}:value', f'Macro {i+1}')

# ---- Long slider: CC5 -> crossfader. Drop width CC6 (it collided with Rotary0 location CC6)
ls = cs['LongSliders']['LongSlider0']
ls['lB1outWidth'] = -1; ls['lB4outWidth'] = -1
m(CH1, 'cc', 5, 'vj:crossfader:value', 'Crossfader')

# ---- Rotary 0: location CC6 -> Media Library browse. Drop speed CC5 (collided with crossfader)
for b in range(1, 5):
    r = cs['Rotaries']['Rotary0']; r[f'rB{b}outSpeed'] = -1
r0 = cs['Rotaries']['Rotary0']; r0['rB1outLocation'] = 6
for b in range(2, 5): r0[f'rB{b}outLocation'] = -1
m(CH1, 'cc', 6, 'tray:browse', 'Library browse (rotary)')

# ---- Rotary 1: press was pressure CC7 (Resync). Make it a clean note -> load highlighted item
r1 = cs['Rotaries']['Rotary1']
for b in range(1, 5): r1[f'rB{b}outSpeed'] = -1
r1['rB1outPress'] = -1; r1['rB1outNote'] = 50; r1['rB1outVelocityValue'] = 127; r1['rB1Channel'] = CH1
btn(CH1, 50, 'tray:load', 'Library load highlighted (press right rotary)')

# ---- Transport: record / stop / play = 33 / 34 / 35
btn(CH1, 33, 'vj:rec',  'Record output')
btn(CH1, 34, 'vj:tap',  'Tap tempo')
btn(CH1, 35, 'tray:rec', 'Record live source to clip')

# ---- Rhombus (note 45) -> stop all
btn(CH1, 45, 'vj:stopall', 'Stop all clips')

# ---- Left/right pairs (36/37 .. 42/43) -> blend prev/next for layer k on both decks
for k in range(4):
    lr = cs['LeftRightButtons'][f'LeftRightButton{k}']
    L, R = lr['leftrightLOutNote'], lr['leftrightROutNote']
    for scope, d in (('vj', 'A'), ('vj-b', 'B')):
        btn(CH1, L, f'{scope}:{k}:blend:prev', f'{d} L{k+1} blend prev')
        btn(CH1, R, f'{scope}:{k}:blend:next', f'{d} L{k+1} blend next')

# ---- Up/down pairs. Left pair (46/47): plain notes -> library tabs.
ud0 = cs['UpDownButtons']['UpDownButton0']
ud0['updownEnableSwitch'] = 0; ud0['updownBankControl'] = 0
btn(CH1, 46, 'tray:tab:next', 'Library next tab')
btn(CH1, 47, 'tray:tab:prev', 'Library prev tab')
ud1 = cs['UpDownButtons']['UpDownButton1']
if VARIANT == 'perform':
    # Right pair (48/49): plain notes -> library item prev/next.
    ud1['updownEnableSwitch'] = 0; ud1['updownBankControl'] = 0
    btn(CH1, 48, 'tray:prev', 'Library prev item')
    btn(CH1, 49, 'tray:next', 'Library next item')
else:
    # Right pair = bank switch for the vertical sliders (Deck A / Deck B). A pair in
    # bank-switch mode sends no notes. Editor drop-down order: Bank Control Off /
    # For Vertical Sliders / For Long Slider / For Rotaries -> 1 = vertical sliders
    # (verified on hardware 2026-10-01).
    BANK_CONTROL_VSLIDERS = 1
    ud1['updownEnableSwitch'] = 1; ud1['updownBankControl'] = BANK_CONTROL_VSLIDERS
    ud1['updownUOutNote'] = -1; ud1['updownDOutNote'] = -1

# ---- Pads. Pad0 = bottom-left, Pad15 = top-right (QuNeo numbering)
pads = cs['Pads']
pads['padBankChangeMode'] = 0
for i in range(4):
    pd = pads[f'Pad{i}']
    press = pd['outDmPress']
    if VARIANT == 'macros':
        # bottom row 0-3: drum mode, pressure only -> macros 5-8 (harder = more, release = 0)
        pd['outDmNote'] = -1; pd['outDmXCC'] = -1; pd['outDmYCC'] = -1
        m(CH1, 'cc', press, f'vj:macro:{i+5}:value', f'Macro {i+5} (pad pressure)')
    else:
        # bottom row 0-3: grid mode on ch2, corner notes 0-15 (free on ch2), no pressure.
        # Left half = Deck A, right half = Deck B, like the clip pads above.
        pd['enableGrid'] = 1; pd['padChannel'] = CH2
        pd['outDmNote'] = -1; pd['outDmPress'] = -1; pd['outDmXCC'] = -1; pd['outDmYCC'] = -1
        base = i * 4
        for j, c in enumerate(('NW', 'NE', 'SW', 'SE')):
            pd[f'outGmNote{c}'] = base + j; pd[f'outGmPress{c}'] = -1; pd[f'outGmVelocityValue{c}'] = 127
        btn(CH2, base + 0, f'vj:{i}:stop',   f'A L{i+1} stop')
        btn(CH2, base + 1, f'vj-b:{i}:stop', f'B L{i+1} stop')
        btn(CH2, base + 2, f'vj:{i}:stop',   f'A L{i+1} stop (lower corner)')
        btn(CH2, base + 3, f'vj-b:{i}:stop', f'B L{i+1} stop (lower corner)')

# rows 2-4: grid mode on ch2, one note per corner, no pressure CCs
corner_notes = {}
for i in range(4, 16):
    pd = pads[f'Pad{i}']
    for c in ('NE', 'NW', 'SE', 'SW'):
        pd[f'outGmPress{c}'] = -1
    if i < 8:   # row 3: the base preset has SW/SE as pressure CCs; give them free even notes 48-62
        base = 48 + (i - 4) * 4
        pd['outGmNoteSW'] = base; pd['outGmNoteSE'] = base + 2
        assert pd['outGmNoteNW'] == base + 1 and pd['outGmNoteNE'] == base + 3
    corner_notes[i] = {c: pd[f'outGmNote{c}'] for c in ('NW', 'NE', 'SW', 'SE')}

for col in range(4):
    top, mid, low = 12 + col, 8 + col, 4 + col
    n = corner_notes
    btn(CH2, n[top]['NW'], f'vj:column:{col}',   f'A column {col+1}')
    btn(CH2, n[top]['NE'], f'vj-b:column:{col}', f'B column {col+1}')
    btn(CH2, n[top]['SW'], f'vj:0:trigger:{col}',   f'A L1 C{col+1}')
    btn(CH2, n[top]['SE'], f'vj-b:0:trigger:{col}', f'B L1 C{col+1}')
    btn(CH2, n[mid]['NW'], f'vj:1:trigger:{col}',   f'A L2 C{col+1}')
    btn(CH2, n[mid]['NE'], f'vj-b:1:trigger:{col}', f'B L2 C{col+1}')
    btn(CH2, n[mid]['SW'], f'vj:2:trigger:{col}',   f'A L3 C{col+1}')
    btn(CH2, n[mid]['SE'], f'vj-b:2:trigger:{col}', f'B L3 C{col+1}')
    btn(CH2, n[low]['NW'], f'vj:3:trigger:{col}',   f'A L4 C{col+1}')
    btn(CH2, n[low]['NE'], f'vj-b:3:trigger:{col}', f'B L4 C{col+1}')
    btn(CH2, n[low]['SW'], f'vj:snapshot:{col*2+1}', f'Snapshot {col*2+1}')
    btn(CH2, n[low]['SE'], f'vj:snapshot:{col*2+2}', f'Snapshot {col*2+2}')

# ---- sanity: a (channel,type,number) may feed several paths only as an intended
#      A/B pair (same action on both decks) or the two corners of one stop pad.
from collections import defaultdict
by = defaultdict(list)
for x in maps: by[(x['channel'], x['type'], x['number'])].append(x['path'])
for key, paths in by.items():
    if len(paths) > 1:
        actions = {q.split(':', 1)[1] for q in paths}
        assert len(actions) == 1 and {q.split(':')[0] for q in paths} <= {'vj', 'vj-b'}, (key, paths)

json.dump(p, open(f'GhostArcade-{VARIANT.title()}.quneopreset', 'w'))
json.dump({'format': 'ghost-arcade-midi-mappings', 'version': 1,
           'controller': f'Keith McMillen QuNeo ({VARIANT})',
           'quneoPreset': f'GhostArcade-{VARIANT.title()}.quneopreset', 'mappings': maps},
          open(f'ghost-arcade-quneo-{VARIANT}-mappings.json', 'w'), indent=2)
print(VARIANT, len(maps), 'mappings')
