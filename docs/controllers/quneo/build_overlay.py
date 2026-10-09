"""Draw the QuNeo overlay sheet for both Ghost Arcade layouts.

    python3 build_overlay.py          -> GhostArcade-QuNeo-overlay.pdf (page 1 Perform, page 2 Macros)

Standard library only: a minimal PDF writer (rects, rounded rects, circles,
lines, Helvetica text) is enough for a layout sheet, and keeps the docs
regenerable without installing anything.
"""
from __future__ import annotations

# ---------------------------------------------------------------- PDF writer
W, H = 792.0, 612.0  # landscape US letter, points

# Helvetica advance widths (per 1000 em) for the characters we use; others fall back.
_HELV = {' ': 278, '!': 278, '"': 355, '%': 889, '&': 667, '(': 333, ')': 333, '*': 389, '+': 584,
         ',': 278, '-': 333, '.': 278, '/': 278, ':': 278, ';': 278, '<': 584, '=': 584, '>': 584,
         '?': 556, 'A': 667, 'B': 667, 'C': 722, 'D': 722, 'E': 667, 'F': 611, 'G': 778, 'H': 722,
         'I': 278, 'J': 500, 'K': 667, 'L': 556, 'M': 833, 'N': 722, 'O': 778, 'P': 667, 'Q': 778,
         'R': 722, 'S': 667, 'T': 611, 'U': 722, 'V': 667, 'W': 944, 'X': 667, 'Y': 667, 'Z': 611,
         'a': 556, 'b': 556, 'c': 500, 'd': 556, 'e': 556, 'f': 278, 'g': 556, 'h': 556, 'i': 222,
         'j': 222, 'k': 500, 'l': 222, 'm': 833, 'n': 556, 'o': 556, 'p': 556, 'q': 556, 'r': 333,
         's': 500, 't': 278, 'u': 556, 'v': 500, 'w': 722, 'x': 500, 'y': 500, 'z': 500,
         '0': 556, '1': 556, '2': 556, '3': 556, '4': 556, '5': 556, '6': 556, '7': 556, '8': 556, '9': 556}
_HELV_BOLD_SCALE = 1.06

def _hex(c: str) -> tuple[float, float, float]:
    c = c.lstrip('#'); return tuple(int(c[i:i + 2], 16) / 255 for i in (0, 2, 4))

def _pdf_str(s: str) -> str:
    # WinAnsi is close enough for the few non-ASCII glyphs; map the ones we use.
    s = s.replace('●', '•').replace('■', '■').replace('▶', '>').replace('◀', '<')
    s = s.replace('■', '#').replace('•', '\u0095')
    s = s.replace('→', '->').replace('×', 'x').replace('—', '-').replace('·', '·')
    out = []
    for ch in s:
        o = ord(ch)
        if ch in '()\\': out.append('\\' + ch)
        elif 32 <= o < 127: out.append(ch)
        elif o < 256: out.append('\\%03o' % o)
        else: out.append('?')
    return ''.join(out)

class Page:
    def __init__(self): self.ops: list[str] = []
    def _color(self, c, op): r, g, b = _hex(c); self.ops.append(f'{r:.3f} {g:.3f} {b:.3f} {op}')
    def rect(self, x, y, w, h, r=0, stroke='#111111', fill=None, lw=1):
        self.ops.append(f'{lw} w'); self._color(stroke, 'RG')
        if fill: self._color(fill, 'rg')
        if r <= 0:
            self.ops.append(f'{x:.2f} {y:.2f} {w:.2f} {h:.2f} re')
        else:
            k = 0.5523 * r
            p = self.ops.append
            p(f'{x + r:.2f} {y:.2f} m')
            p(f'{x + w - r:.2f} {y:.2f} l {x + w - r + k:.2f} {y:.2f} {x + w:.2f} {y + r - k:.2f} {x + w:.2f} {y + r:.2f} c')
            p(f'{x + w:.2f} {y + h - r:.2f} l {x + w:.2f} {y + h - r + k:.2f} {x + w - r + k:.2f} {y + h:.2f} {x + w - r:.2f} {y + h:.2f} c')
            p(f'{x + r:.2f} {y + h:.2f} l {x + r - k:.2f} {y + h:.2f} {x:.2f} {y + h - r + k:.2f} {x:.2f} {y + h - r:.2f} c')
            p(f'{x:.2f} {y + r:.2f} l {x:.2f} {y + r - k:.2f} {x + r - k:.2f} {y:.2f} {x + r:.2f} {y:.2f} c h')
        self.ops.append('B' if fill else 'S')
    def circle(self, cx, cy, r, stroke='#111111', lw=1):
        k = 0.5523 * r; self.ops.append(f'{lw} w'); self._color(stroke, 'RG'); p = self.ops.append
        p(f'{cx + r:.2f} {cy:.2f} m')
        p(f'{cx + r:.2f} {cy + k:.2f} {cx + k:.2f} {cy + r:.2f} {cx:.2f} {cy + r:.2f} c')
        p(f'{cx - k:.2f} {cy + r:.2f} {cx - r:.2f} {cy + k:.2f} {cx - r:.2f} {cy:.2f} c')
        p(f'{cx - r:.2f} {cy - k:.2f} {cx - k:.2f} {cy - r:.2f} {cx:.2f} {cy - r:.2f} c')
        p(f'{cx + k:.2f} {cy - r:.2f} {cx + r:.2f} {cy - k:.2f} {cx + r:.2f} {cy:.2f} c S')
    def line(self, x1, y1, x2, y2, stroke='#cccccc', lw=1):
        self.ops.append(f'{lw} w'); self._color(stroke, 'RG'); self.ops.append(f'{x1:.2f} {y1:.2f} m {x2:.2f} {y2:.2f} l S')
    @staticmethod
    def width(s, size, bold=False):
        w = sum(_HELV.get(ch, 556) for ch in s) / 1000 * size
        return w * (_HELV_BOLD_SCALE if bold else 1)
    def text(self, x, y, s, size=7, color='#111111', bold=False, center=True):
        if center: x -= self.width(s, size, bold) / 2
        self._color(color, 'rg')
        self.ops.append(f'BT /{"F2" if bold else "F1"} {size} Tf {x:.2f} {y:.2f} Td ({_pdf_str(s)}) Tj ET')

def write_pdf(path: str, pages: list[Page], title: str):
    objs: list[bytes] = []
    def add(b: str | bytes) -> int:
        objs.append(b.encode('latin-1') if isinstance(b, str) else b); return len(objs)
    f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
    f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')
    page_ids = []
    pages_id = len(objs) + 2 * len(pages) + 1
    for pg in pages:
        stream = '\n'.join(pg.ops).encode('latin-1')
        c = add(b'<< /Length %d >>\nstream\n' % len(stream) + stream + b'\nendstream')
        page_ids.append(add(f'<< /Type /Page /Parent {pages_id} 0 R /MediaBox [0 0 {W} {H}] '
                            f'/Resources << /Font << /F1 {f1} 0 R /F2 {f2} 0 R >> >> /Contents {c} 0 R >>'))
    assert add(f'<< /Type /Pages /Kids [{" ".join(f"{i} 0 R" for i in page_ids)}] /Count {len(page_ids)} >>') == pages_id
    cat = add(f'<< /Type /Catalog /Pages {pages_id} 0 R >>')
    info = add(f'<< /Title ({_pdf_str(title)}) /Producer (build_overlay.py) >>')
    out = bytearray(b'%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'); offsets = []
    for i, body in enumerate(objs, 1):
        offsets.append(len(out)); out += b'%d 0 obj\n' % i + body + b'\nendobj\n'
    xref = len(out)
    out += b'xref\n0 %d\n0000000000 65535 f \n' % (len(objs) + 1)
    for o in offsets: out += b'%010d 00000 n \n' % o
    out += b'trailer\n<< /Size %d /Root %d 0 R /Info %d 0 R >>\nstartxref\n%d\n%%%%EOF\n' % (len(objs) + 1, cat, info, xref)
    open(path, 'wb').write(out)

# ---------------------------------------------------------------- layout
INK = '#111111'; A = '#1d6fd8'; B = '#d8452f'; G = '#2e9a52'; P = '#7a3fc4'; MUTE = '#666666'; RED = '#c62828'

def draw(variant: str) -> Page:
    c = Page(); perform = variant == 'perform'
    box, txt = c.rect, c.text
    fx, fy, fw, fh = 40, 70, 712, 470
    box(fx, fy, fw, fh, r=22)
    txt(W / 2, H - 38, f'Ghost Arcade  x  QuNeo  -  {variant.upper()} layout', 11, bold=True)
    txt(W / 2, H - 54, f'GhostArcade-{variant.title()}.quneopreset  +  ghost-arcade-quneo-{variant}-mappings.json      '
        'Blue = Deck A   Red = Deck B   Green = Media Library   Purple = macros / global', 7.5, MUTE)
    L = fx + 18
    # transport row
    top = fy + fh - 52
    for i, (lab, sub) in enumerate([('REC OUT', 'vj:rec'), ('TAP', 'vj:tap'), ('REC SRC', 'tray:rec')]):
        x = L + i * 52; box(x, top, 40, 32, r=10)
        txt(x + 20, top + 18, lab, 6.5, G if 'SRC' in lab else P, bold=True); txt(x + 20, top + 8, sub, 5, MUTE)
    # 4 rows: L/R blend pair + horizontal slider
    for r in range(4):
        y = top - 46 - r * 40
        box(L, y, 44, 28, r=12); txt(L + 22, y + 16, 'BLEND', 6.5, P, bold=True); txt(L + 22, y + 7, f'< L{r + 1} >  A+B', 5.5, MUTE)
        box(L + 54, y, 150, 28, r=12)
        if perform:
            txt(L + 129, y + 17, f'B  L{r + 1}  OPACITY', 7.5, B, bold=True); txt(L + 129, y + 7, f'vj-b:{r}:opacity', 5.5, MUTE)
        else:
            txt(L + 129, y + 17, f'MACRO {r + 1}', 7.5, P, bold=True); txt(L + 129, y + 7, ['ENERGY', 'CHAOS', 'DRAMA', 'BUILD'][r], 6, MUTE)
    # rotaries + rhombus
    ry = top - 46 - 4 * 40 - 80
    c.circle(L + 50, ry + 38, 44, INK); c.circle(L + 160, ry + 38, 44, INK)
    txt(L + 50, ry + 44, 'BROWSE', 8, G, bold=True); txt(L + 50, ry + 33, 'tray:browse', 5.5, MUTE); txt(L + 50, ry + 24, 'turn = move cursor', 5.5, MUTE)
    txt(L + 160, ry + 44, 'LOAD', 8, G, bold=True); txt(L + 160, ry + 33, 'press = tray:load', 5.5, MUTE); txt(L + 160, ry + 24, '(turning does nothing)', 5.5, MUTE)
    box(L + 93, ry - 22, 24, 18, r=6); txt(L + 105, ry - 15, 'STOP', 5.5, INK, bold=True); txt(L + 105, ry - 30, 'stop all', 5, MUTE)
    # vertical sliders
    vy = fy + 28
    for i in range(4):
        x = L + i * 54; hh = ry - vy - 44; box(x, vy, 36, hh, r=14)
        txt(x + 18, vy + hh / 2 + 8, f'L{i + 1}', 9, bold=True); txt(x + 18, vy + hh / 2 - 4, 'opacity', 5.5, MUTE)
        txt(x + 18, vy + hh / 2 - 13, 'Deck A' if perform else 'bank 1 A', 5.5, A if perform else MUTE, bold=perform)
        if not perform: txt(x + 18, vy + hh / 2 - 21, 'bank 2 B', 5.5, MUTE)
    # pads
    px, py, ps, gap = fx + 282, fy + 66, 88, 8
    rows = {
        3: lambda k: (('COL ' + str(k + 1), A), ('COL ' + str(k + 1), B), (f'L1 C{k + 1}', A), (f'L1 C{k + 1}', B)),
        2: lambda k: ((f'L2 C{k + 1}', A), (f'L2 C{k + 1}', B), (f'L3 C{k + 1}', A), (f'L3 C{k + 1}', B)),
        1: lambda k: ((f'L4 C{k + 1}', A), (f'L4 C{k + 1}', B), (f'SNAP {k * 2 + 1}', P), (f'SNAP {k * 2 + 2}', P)),
        0: lambda k: ((f'STOP L{k + 1}', A), (f'STOP L{k + 1}', B), (f'STOP L{k + 1}', A), (f'STOP L{k + 1}', B)),
    }
    for row in range(4):
        for col in range(4):
            x = px + col * (ps + gap); y = py + row * (ps + gap)
            box(x, y, ps, ps, r=12)
            if row == 0 and not perform:
                txt(x + ps / 2, y + ps / 2 + 6, f'MACRO {col + 5}', 9, P, bold=True); txt(x + ps / 2, y + ps / 2 - 6, 'press harder = more', 5.5, MUTE)
                txt(x + ps / 2, y + ps / 2 - 15, ['SUB', 'AIR', 'FX', 'WILD'][col], 6, MUTE)
                continue
            c.line(x + ps / 2, y + 6, x + ps / 2, y + ps - 6); c.line(x + 6, y + ps / 2, x + ps - 6, y + ps / 2)
            if row == 0:
                c.line(x + 6, y + ps / 2, x + ps - 6, y + ps / 2, stroke='#ffffff', lw=2)  # whole half = one action
            corners = list(zip(rows[row](col), ((x + ps / 4, y + 3 * ps / 4), (x + 3 * ps / 4, y + 3 * ps / 4), (x + ps / 4, y + ps / 4), (x + 3 * ps / 4, y + ps / 4))))
            if row == 0: corners = corners[:2]  # whole left / right half is one action
            for (lab, colr), (cx, cy) in corners:
                txt(cx, cy - 2 - (14 if row == 0 else 0), lab, 7, colr, bold=True)
            if row == 0:
                txt(x + ps / 4, y + ps / 2 - 6, 'left = A', 5, MUTE); txt(x + 3 * ps / 4, y + ps / 2 - 6, 'right = B', 5, MUTE)
    txt(px + 2 * (ps + gap) - gap / 2, py + 4 * (ps + gap) + 2,
        'Top-row top corners launch a whole column on that deck  |  every pad: left corner = Deck A, right corner = Deck B'
        + ('  |  bottom row: stop that layer' if perform else ''), 6.5, MUTE)
    # bottom: up/down pairs + long slider
    by = fy + 18
    box(px, by, 40, 40, r=12); txt(px + 20, by + 27, 'TAB ^', 6.5, G, bold=True); txt(px + 20, by + 9, 'TAB v', 6.5, G, bold=True)
    rx = px + 4 * (ps + gap) - gap - 40; box(rx, by, 40, 40, r=12)
    if perform:
        txt(rx + 20, by + 27, 'ITEM ^', 6.5, G, bold=True); txt(rx + 20, by + 9, 'ITEM v', 6.5, G, bold=True)
    else:
        txt(rx + 20, by + 28, 'SLIDERS', 5.5, INK, bold=True); txt(rx + 20, by + 18, 'A / B', 6.5, INK, bold=True); txt(rx + 20, by + 7, 'left LED = B', 4.5, MUTE)
    box(px + 52, by + 8, 4 * (ps + gap) - gap - 104, 24, r=12); txt(px + 2 * (ps + gap) - gap / 2, by + 16, 'CROSSFADER   A  <---------->  B', 8, INK, bold=True)
    txt(W / 2, 40, 'Ghost Arcade QuNeo layout. Pad grid is 4 x 4 per deck. If a control comes out on the wrong layer, fix it in build_quneo_preset.py and regenerate.', 6.5, MUTE)
    return c

if __name__ == '__main__':
    write_pdf('GhostArcade-QuNeo-overlay.pdf', [draw('perform'), draw('macros')], 'Ghost Arcade - QuNeo overlay')
    print('GhostArcade-QuNeo-overlay.pdf (2 pages)')
