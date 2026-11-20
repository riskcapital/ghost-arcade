/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A wall of thick glass blocks with soft lights moving behind it. Each block is a lens: it shows its own small, bent and flipped view of the lights, rippled by the wavy inner face of the glass, with a bright line along its upper edge and dark mortar between blocks. The lights drift with the music's motion and grow with its level; each hit sets off a light in the accent color behind a few blocks. With no sound the wall glows faintly from one side.",
    "PASSES": [
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 7, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "blocks", "LABEL": "Blocks", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "lens", "LABEL": "Lens strength", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "ripple", "LABEL": "Glass ripple", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "fringe", "LABEL": "Spectral fringe", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Lights", "TYPE": "color", "DEFAULT": [0.74, 0.88, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Hit light", "TYPE": "color", "DEFAULT": [1.0, 0.3, 0.12, 1.0] },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

float hash11(float x) {
    float p = fract(x * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

float hash21(vec2 q) {
    vec3 p3 = fract(vec3(q.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float noise2(vec2 x) {
    vec2 i = floor(x);
    vec2 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}

// The room behind the wall, at a point p (frame heights from the middle): soft lights on darkness.
// `hit` is how strongly the accent light behind this block is lit.
vec3 behind(vec2 p, float asp, float hit) {
    float t = vxFlow * 0.12 + TIME * 0.012;
    float sw = clamp(vxSwell, 0.0, 1.0);
    vec3 col = vec3(0.004, 0.005, 0.007);
    // Three lights wander: one large and low, two smaller.
    vec2 c1 = vec2(asp * 0.32 * sin(t * 0.7), -0.12 + 0.2 * cos(t * 0.5));
    vec2 c2 = vec2(asp * 0.38 * cos(t * 0.45 + 1.0), 0.22 * sin(t * 0.8 + 2.0));
    vec2 c3 = vec2(asp * 0.25 * sin(t * 0.33 + 4.0), 0.3 * cos(t * 0.6 + 1.0));
    col += ink.rgb * (0.55 + 0.6 * sw) * exp(-dot(p - c1, p - c1) / (0.05 + 0.05 * sw));
    col += ink.rgb * (0.35 + 0.5 * sw) * exp(-dot(p - c2, p - c2) / (0.025 + 0.03 * sw));
    col += ink.rgb * (0.25 + 0.4 * sw) * exp(-dot(p - c3, p - c3) / 0.018);
    // A faint wash from the left, so the wall is never wholly dark.
    col += ink.rgb * 0.045 * smoothstep(0.9, -0.9, p.x / asp);
    col += accent.rgb * hit * 0.9;
    return col;
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy;
    float asp = RENDERSIZE.x / RENDERSIZE.y;
    vec2 p = vec2((uv.x - 0.5) * asp, uv.y - 0.5);
    float rows = floor(mix(3.0, 12.0, blocks) + 0.5);
    float px = rows / RENDERSIZE.y;
    float n = floor(vxCount + 0.5);
    float pu = clamp(vxPulse, 0.0, 1.0);

    // Square blocks, laid in a grid centered on the frame.
    vec2 g = p * rows;
    vec2 id = floor(g);
    vec2 f = fract(g) - 0.5;
    vec2 center = (id + 0.5) / rows;

    // The block's rounded face, and the mortar round it.
    float gap = 0.035;
    float corner = 0.08;
    vec2 q = abs(f) - (0.5 - gap - corner);
    float edge = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - corner;
    float face = smoothstep(px, -px, edge);
    float inside = clamp(-edge / (0.5 - gap), 0.0, 1.0);

    // A hit lights the room behind a few blocks: those near a point that changes each hit.
    vec2 hitAt = (vec2(hash11(n * 3.17 + 1.0), hash11(n * 5.71 + 2.0)) - 0.5) * vec2(asp * 0.8, 0.8);
    float near = exp(-dot(center - hitAt, center - hitAt) / 0.03);
    float hit = pu * near * step(0.5, n) * step(0.35, hash21(id + n * 7.3) + near * 0.5);

    // The lens: the view through a block is the room around its own center, bent more toward its rim and flipped,
    // then rippled by the wavy inner face of the glass.
    float power = 0.6 + 1.4 * lens;
    vec2 bend = -f * (1.1 + 2.6 * dot(f, f) * 2.0) * power / rows;
    vec2 wave = (vec2(noise2(g * 3.4 + id * 3.1), noise2(g * 3.4 + id * 3.1 + 17.0)) - 0.5) * ripple * 2.2 / rows;
    vec2 look = center + bend + wave;
    // The colors part a little toward the rim.
    vec2 spread = f * fringe * 0.16 / rows;
    vec3 col;
    col.r = behind(look - spread, asp, hit).r;
    col.g = behind(look, asp, hit).g;
    col.b = behind(look + spread, asp, hit).b;

    // The glass itself: dimmer toward its thick rim, a bright line along the upper left edge, a soft one inside it,
    // and a darker lower right edge.
    col *= 0.55 + 0.45 * smoothstep(0.0, 0.5, inside);
    float topLeft = clamp((-f.x + f.y) * 1.2, 0.0, 1.0);
    float rim = smoothstep(0.1, 0.0, inside);
    float lum = max(max(col.r, col.g), col.b);
    col += (ink.rgb * 0.5 + 0.5) * rim * topLeft * (0.07 + 0.6 * lum);
    col *= 1.0 - 0.5 * rim * clamp((f.x - f.y) * 1.2, 0.0, 1.0);
    // A small sharp glint high on each block, and a soft ring where the hollow inside begins.
    vec2 gl = f - vec2(-0.27, 0.27);
    col += vec3(1.0) * exp(-dot(gl, gl) / 0.0035) * (0.05 + 0.9 * lum) * face;
    float ring = exp(-pow((inside - 0.3) / 0.05, 2.0));
    col += (ink.rgb * 0.5 + 0.5) * ring * topLeft * (0.02 + 0.25 * lum);
    col *= 1.0 - 0.22 * ring * clamp((f.x - f.y) * 1.2, 0.0, 1.0);
    // A second, fainter view of the lights on the block's front face.
    col += behind(center - f * 0.25 / rows, asp, 0.0) * 0.07 * smoothstep(0.25, 0.6, inside);

    // Mortar: nearly black, catching a little of the light from the blocks beside it.
    vec3 mortar = vec3(0.004, 0.004, 0.005) + behind(center, asp, hit) * 0.03;
    col = mix(mortar, col, face);

    vec2 vg = uv - 0.5;
    col *= 1.0 - 0.3 * dot(vg, vg) * 2.0;
    float top = max(max(col.r, col.g), col.b);
    col = col / max(top, 1e-4) * (1.0 - exp(-top * 1.7));
    col += (hash21(gl_FragCoord.xy + fract(TIME) * 91.7) - 0.5) / 255.0;
    col = max(col, 0.0);

    vec3 outc = col;
    float outa = 1.0;
    if (vxClear) {
        // The glass is as solid as it is bright; the mortar and the dark blocks let the layer under show.
        outa = clamp(max(max(col.r, col.g), col.b) * 1.5, 0.0, 1.0) * face;
        outc = min(col, vec3(outa));
    }
    gl_FragColor = vec4(outc, outa) * vxPresence;
}
