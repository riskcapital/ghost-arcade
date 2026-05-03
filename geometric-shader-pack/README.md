# Geometric Shader Pack

25 simple, hard-edged geometric shaders for live VJ work — designed for
the techno / Boiler Room aesthetic where a single bold shape pulsing
in solid color through a slice grid does more than a 50-octave
particle simulation.

Hosted as a separate cloud-sync pack rather than baked into the main
ISF library, so users can opt in.

## Conventions

Every shader follows the same spec:

- ISF v2.0, fragment shader only (`.fs`)
- Categories: `Geometric, Generator`
- Bound to a max of 5–7 inputs each
- Hard `step()`-based masks (no smoothstep / no AA gradients) — by design
- Color inputs default to white/black or a brand-relevant pop color

### Common input names

| Name         | Type   | Range   | What it does |
|--------------|--------|---------|--------------|
| `speed`      | float  | varies  | Animation rate. Negative scrolls reverse where it makes sense. |
| `audioLevel` | float  | 0..1    | Manual slider today; will be wired to the global FFT routing once that ships, no shader change needed. |
| `color1`     | color  | RGBA    | Foreground / "lit" color. |
| `color2`     | color  | RGBA    | Background / "dark" color. Defaults to black for most. |
| `intensity`  | float  | 0..1    | Overall brightness multiplier. |
| `rotateSpeed`| float  | -3..3   | Where applicable. |

## The 25

### Solid fills (5)
1. `01-strobe.fs` — duty-cycle two-color strobe
2. `02-color-cycle.fs` — full-saturation hue cycle, optional step quantization
3. `03-audio-luminance.fs` — solid color whose brightness rides `audioLevel`
4. `04-hue-shift.fs` — smooth chroma rotation
5. `05-two-color-flicker.fs` — pseudo-random A/B flicker

### Single primitives (8)
6. `06-pulsing-circle.fs` — circle that breathes between min/max
7. `07-rotating-square.fs` — filled square spinning
8. `08-scaling-triangle.fs` — equilateral triangle scaling
9. `09-plus-cross.fs` — plus / cross sign
10. `10-diamond.fs` — rhombus with stretch + rotation
11. `11-ring.fs` — hollow ring / donut
12. `12-hex.fs` — hexagon
13. `13-star.fs` — N-point star (3..12 points)

### Repeating geometry (6)
14. `14-grid.fs` — wireframe grid
15. `15-checkerboard.fs` — two-tone checker, optional rotation + scroll
16. `16-dot-matrix.fs` — pulsing LED-style dots
17. `17-diagonal-stripes.fs` — chase stripes at any angle
18. `18-vertical-bars.fs` — EQ-style bars (sine simulation today, FFT-routable later)
19. `19-concentric-rings.fs` — expanding/contracting rings

### Sweeps & wipes (4)
20. `20-diagonal-sweep.fs` — single line sweeping at any angle
21. `21-radial-sweep.fs` — radar wedge rotating around center
22. `22-horizontal-wipe.fs` — solid color block wiping L→R
23. `23-iris.fs` — circular iris opening/closing

### Screen-fill effects (2)
24. `24-kick-flash.fs` — full-screen flash above audio threshold + decay
25. `25-rgb-roll.fs` — RGB chase bars (old broadcast / glitch look)

## Adding to the website's sync library

Each `.fs` file is a self-contained ISF document — drop the whole folder
into the cloud-shader catalog and they'll appear in users' Shader
Library on next sync.
