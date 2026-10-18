/*{
    "DESCRIPTION": "A light curtain. A tight row of narrow beams drops from the truss like the bars of a cage, the look of ACL bars and beam battens. The whole curtain can lean, fan open from a point and sway, and the dimmers run chases along it: a sweep, a bounce, a centre burst, a sparkle or a wave. Many thin beams read as architecture rather than as separate lights, so this frames a band without flattening it. Bass lifts the dimmers, beats step the chase, spectral centroid leans the curtain.",
    "CREDIT": "Ghost Arcade 2.0 stage pack",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Audio Reactive"],
    "INPUTS": [
        {"NAME": "colorMode", "TYPE": "long", "DEFAULT": 0,
         "VALUES": [0, 1, 2, 3, 4, 5, 6],
         "LABELS": ["Halogen", "Cobalt", "Blood Orange", "Mint", "Ultraviolet", "Candy Floss", "Steel"]},
        {"NAME": "colorPattern", "TYPE": "long", "DEFAULT": 0,
         "VALUES": [0, 1, 2, 3, 4],
         "LABELS": ["One colour", "Alternate", "Centre to edge", "Bands of three", "Rainbow"]},
        {"NAME": "beams",     "TYPE": "float", "DEFAULT": 24.0, "MIN": 4.0, "MAX": 64.0},
        {"NAME": "beamWidth", "TYPE": "float", "DEFAULT": 0.50, "MIN": 0.05, "MAX": 1.00},
        {"NAME": "edge",      "TYPE": "float", "DEFAULT": 0.50, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "lean",      "TYPE": "float", "DEFAULT": 0.00, "MIN": -1.00, "MAX": 1.00},
        {"NAME": "fan",       "TYPE": "float", "DEFAULT": 0.25, "MIN": -1.00, "MAX": 1.00},
        {"NAME": "sway",      "TYPE": "float", "DEFAULT": 0.30, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "swaySpeed", "TYPE": "float", "DEFAULT": 0.40, "MIN": 0.00, "MAX": 3.00},
        {"NAME": "ripple",    "TYPE": "float", "DEFAULT": 0.00, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "chase",     "TYPE": "long",  "DEFAULT": 1,
         "VALUES": [0, 1, 2, 3, 4, 5],
         "LABELS": ["All on", "Sweep", "Bounce", "Centre burst", "Sparkle", "Wave"]},
        {"NAME": "chaseSpeed","TYPE": "float", "DEFAULT": 0.60, "MIN": 0.00, "MAX": 6.00},
        {"NAME": "chaseDepth","TYPE": "float", "DEFAULT": 0.70, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "tail",      "TYPE": "float", "DEFAULT": 0.50, "MIN": 0.05, "MAX": 1.00},
        {"NAME": "throwLength","TYPE": "float", "DEFAULT": 0.90, "MIN": 0.10, "MAX": 1.00},
        {"NAME": "fromBelow", "TYPE": "bool",  "DEFAULT": 0},
        {"NAME": "haze",      "TYPE": "float", "DEFAULT": 0.75, "MIN": 0.00, "MAX": 1.50},
        {"NAME": "hazeTexture","TYPE": "float", "DEFAULT": 0.40, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "hazeDrift", "TYPE": "float", "DEFAULT": 0.30, "MIN": 0.00, "MAX": 2.00},
        {"NAME": "lensGlow",  "TYPE": "float", "DEFAULT": 0.50, "MIN": 0.00, "MAX": 1.50},
        {"NAME": "hueShift",  "TYPE": "float", "DEFAULT": 0.00, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "exposure",  "TYPE": "float", "DEFAULT": 1.00, "MIN": 0.20, "MAX": 2.00}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

/*
 * Sixty beams would be sixty loop turns if each were drawn on its own. They
 * are not: the beams of a curtain are evenly spaced along the truss, so the
 * frame is first straightened (undoing the lean and the fan so every beam is
 * a vertical stripe), and then one divide tells a pixel which beam it is in.
 * The cost is the same for four beams or sixty-four.
 *
 * Straightening keeps track of how much it stretched the frame, so a beam
 * stays the width it was asked to be however far the curtain fans.
 */

const float TAU = 6.28318530718;

float hash11(float p) {
    p = fract(p * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

float hash21(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
}

float noise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1, 0)), f.x),
               mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), f.x), f.y);
}

/* Gel sets for the curtain. Columns: [main, second, accent]. */
mat3 paletteFor(int mode) {
    vec3 a, b, c;
    if (mode == 1) {            /* Cobalt */
        a = vec3(0.10, 0.26, 1.00);
        b = vec3(0.50, 0.80, 1.00);
        c = vec3(0.90, 0.95, 1.00);
    } else if (mode == 2) {     /* Blood Orange */
        a = vec3(1.00, 0.16, 0.04);
        b = vec3(1.00, 0.56, 0.06);
        c = vec3(0.86, 0.04, 0.24);
    } else if (mode == 3) {     /* Mint */
        a = vec3(0.30, 1.00, 0.72);
        b = vec3(0.86, 1.00, 0.92);
        c = vec3(0.06, 0.70, 0.90);
    } else if (mode == 4) {     /* Ultraviolet */
        a = vec3(0.42, 0.10, 1.00);
        b = vec3(0.86, 0.20, 1.00);
        c = vec3(0.20, 0.50, 1.00);
    } else if (mode == 5) {     /* Candy Floss */
        a = vec3(1.00, 0.46, 0.80);
        b = vec3(0.50, 0.86, 1.00);
        c = vec3(1.00, 0.92, 0.60);
    } else if (mode == 6) {     /* Steel */
        a = vec3(0.70, 0.80, 0.92);
        b = vec3(0.36, 0.50, 0.70);
        c = vec3(1.00, 1.00, 1.00);
    } else {                    /* Halogen - warm white, amber, pale straw */
        a = vec3(1.00, 0.86, 0.64);
        b = vec3(1.00, 0.62, 0.24);
        c = vec3(1.00, 0.95, 0.84);
    }
    return mat3(a, b, c);
}

vec3 hueRotate(vec3 c, float turns) {
    float a = turns * TAU;
    vec3 k = vec3(0.57735);
    return c * cos(a) + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - cos(a));
}

void main() {
    vec2 res = RENDERSIZE.xy;
    vec2 uv = (gl_FragCoord.xy - 0.5 * res) / res.y;
    float aspect = res.x / res.y;
    if (fromBelow) uv.y = -uv.y;

    float bass = max(audioBass, 0.24 + 0.10 * sin(TIME * 0.21));
    float centroid = max(audioSpectralCentroid, 0.44 + 0.16 * sin(TIME * 0.12));
    float beat = audioBeat;

    float count = floor(beams);
    /* Distance down from the truss, 0 at the top of the frame. */
    float drop = 0.5 - uv.y;

    /* Undo the lean and the fan: find where on the truss this pixel's beam began. */
    float swing = sway * sin(TIME * swaySpeed) + (centroid - 0.5) * 0.25;
    float slope = lean * 0.9 + swing * 0.7;
    float spreadK = fan * 1.6;
    float stretch = 1.0 + spreadK * drop;                /* how much a beam has spread by here */
    float x0 = (uv.x - slope * drop) / max(stretch, 0.08);
    /* A slow snake along the curtain, if asked for. */
    x0 += ripple * 0.05 * sin(drop * 9.0 - TIME * swaySpeed * 3.0 + x0 * 3.0) * drop;

    float span = aspect * 1.04;
    float cell = (x0 / span + 0.5) * count;
    float id = floor(cell);
    float inRig = step(0.0, id) * step(id, count - 1.0);
    float across = (fract(cell) - 0.5) * 2.0;           /* -1 .. 1 across one beam's slot */

    /* Beam profile. Width is held in screen terms by dividing out the stretch. */
    float slotHalf = clamp(beamWidth * 0.95 / max(stretch, 0.3), 0.02, 0.98);
    float x = abs(across) / slotHalf;
    float body = 1.0 - smoothstep(mix(0.2, 0.9, edge), 1.0, x);
    float core = exp(-x * x * 4.5);
    float profile = mix(core, body * 0.75 + core * 0.45, edge);

    /* Dimmer chase along the row. */
    float u = id / max(count - 1.0, 1.0);                 /* 0 .. 1 along the truss */
    float ct = TIME * chaseSpeed + beat * 0.2;
    int mode = int(chase);
    float dim = 1.0;
    float sharp = mix(14.0, 1.6, tail);
    if (mode == 1) dim = exp(-fract(ct * 0.5 - u) * sharp);
    else if (mode == 2) {
        float head = 0.5 + 0.5 * sin(ct * 1.2);
        dim = exp(-abs(u - head) * sharp * 1.6);
    } else if (mode == 3) dim = exp(-fract(ct * 0.5 - abs(u - 0.5) * 2.0) * sharp);
    else if (mode == 4) {
        float slot = floor(ct * 3.0 + hash11(id) * 5.0);
        float f = fract(ct * 3.0 + hash11(id) * 5.0);
        dim = step(0.72, hash11(id * 3.1 + slot)) * exp(-f * sharp * 0.6);
    } else if (mode == 5) dim = 0.5 + 0.5 * sin(u * TAU * 2.0 - ct * 2.0);
    dim = mix(1.0, dim, mode == 0 ? 0.0 : chaseDepth);

    /* Colour dealt along the row. */
    mat3 pal = paletteFor(int(colorMode));
    int pattern = int(colorPattern);
    vec3 gel = pal[0];
    if (pattern == 1) gel = mod(id, 2.0) < 0.5 ? pal[0] : pal[1];
    else if (pattern == 2) gel = mix(pal[2], pal[0], smoothstep(0.0, 1.0, abs(u - 0.5) * 2.0));
    else if (pattern == 3) {
        float band = mod(floor(u * 2.999), 3.0);
        gel = band < 0.5 ? pal[0] : band < 1.5 ? pal[1] : pal[2];
    } else if (pattern == 4) gel = hueRotate(vec3(1.0, 0.12, 0.10), u + TIME * 0.03);
    gel = hueRotate(gel, hueShift);

    /* Haze, and the throw running out. */
    vec2 hp = uv * vec2(2.4, 3.2) + vec2(TIME * hazeDrift * 0.10, -TIME * hazeDrift * 0.05);
    float wisps = noise2(hp) * 0.55 + noise2(hp * 2.2 + 5.0) * 0.30 + noise2(hp * 4.7 - 3.0) * 0.15;
    float air = haze * mix(1.0, 0.30 + 1.4 * wisps, hazeTexture);
    float reach = throwLength * 1.15;
    float runout = (1.0 - smoothstep(reach * 0.6, reach, drop)) * step(0.0, drop);
    float thin = 1.0 / (0.55 + 0.45 * max(stretch, 0.3));

    vec3 col = gel * profile * air * runout * thin * dim * inRig * (1.25 + 0.90 * bass);

    /* Lenses along the truss. */
    float lensX = (id + 0.5) / count - 0.5;
    vec2 lensPos = vec2(lensX * span, 0.5);
    float ld = length((uv - lensPos) * vec2(1.0, 1.0));
    float lens = (0.00018 / (ld * ld + 0.00008)) * lensGlow * inRig;
    col += mix(gel, vec3(1.0), 0.6) * lens * dim * 0.6;

    col *= 1.0 + beat * 0.20;
    col *= exposure;
    col = col / (1.0 + 0.22 * col);
    col *= 1.22;

    gl_FragColor = vec4(col, 1.0);
}
