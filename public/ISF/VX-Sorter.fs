/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "Real pixel sorting, done live. The voice paints a dusk sky: a low sun, banks of cloud and a dark ridge. Wherever that picture is brighter than the threshold, its pixels are sorted along their column, a step at a time, so the bright parts pour upward into long clean gradients with hard ends while the rest stays a photograph. The sound's level lowers the threshold, so more of the picture gives way; each hit pours fresh picture into some of the columns, and they sort again from the start.",
    "PASSES": [
        { "TARGET": "sortA", "PERSISTENT": true, "FLOAT": true, "WIDTH": "$WIDTH/2", "HEIGHT": "$HEIGHT/3" },
        { "TARGET": "sortB", "PERSISTENT": true, "FLOAT": true, "WIDTH": "$WIDTH/2", "HEIGHT": "$HEIGHT/3" },
        { "TARGET": "sortC", "PERSISTENT": true, "FLOAT": true, "WIDTH": "$WIDTH/2", "HEIGHT": "$HEIGHT/3" },
        { "TARGET": "sortD", "PERSISTENT": true, "FLOAT": true, "WIDTH": "$WIDTH/2", "HEIGHT": "$HEIGHT/3" },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 2, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "threshold", "LABEL": "Threshold", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "repour", "LABEL": "Columns poured again on a hit", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0, "MAX": 1 },
        { "NAME": "sideways", "LABEL": "Sort sideways", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "darks", "LABEL": "Sort the darks instead", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "cloud", "LABEL": "Cloud", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Sky", "TYPE": "color", "DEFAULT": [0.62, 0.78, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Sun", "TYPE": "color", "DEFAULT": [1.0, 0.42, 0.16, 1.0] },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// The sort runs in four small buffers, each a copy of the one before with one more step of sorting done,
// so the picture sorts four pixels' worth every frame. A pixel in the buffers holds its color (rgb) and,
// in alpha, the hit that last poured it there (plus one; zero means nothing poured yet).
//
// One step: every pixel is paired with the one above or below it (the pairing alternates step by step), and a
// pair that is out of order swaps. Only pairs where both places are bright enough in the painted picture take
// part, so a run of bright pixels sorts within itself and stops dead at its ends.

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

float fbm(vec2 x) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
        v += a * noise2(x);
        x = x * 2.03 + vec2(17.0, 9.0);
        a *= 0.5;
    }
    return v;
}

// The painted picture: a dusk sky with a low sun, banks of cloud lit from below, and a dark ridge.
vec3 painted(vec2 uv, float asp) {
    vec2 p = vec2((uv.x - 0.5) * asp, uv.y);
    float t = vxFlow * 0.03 + TIME * 0.004;
    vec2 sun = vec2(0.28 * asp * sin(t * 0.6), 0.34);
    float d = length(p - sun);
    // Sky: deep above, lighter toward the horizon, warmed round the sun.
    vec3 sky = mix(ink.rgb * 0.62, ink.rgb * 0.035, smoothstep(0.18, 0.95, uv.y));
    sky += accent.rgb * 0.55 * exp(-d * 3.2);
    sky += accent.rgb * 1.2 * exp(-d * d / 0.01) + vec3(1.0) * 0.9 * exp(-d * d / 0.0022);
    // Cloud: a few long banks, dark against the sky, their undersides and edges catching the sun.
    vec2 cq = vec2(p.x * 1.3 + t * 2.0, p.y * 6.0 - t * 0.6);
    float c = fbm(cq);
    float banks = smoothstep(0.56, 0.7, c * (0.7 + 0.6 * cloud) + 0.12 * smoothstep(0.35, 0.9, uv.y));
    float under = clamp((fbm(cq - vec2(0.0, 0.22)) - c) * 5.0 + 0.35, 0.0, 1.0);
    float edgeLight = banks * (1.0 - banks) * 4.0;
    vec3 cl = ink.rgb * 0.05 + (ink.rgb * 0.5 + accent.rgb * 0.9) * (under * 0.8 + edgeLight * 0.5) * exp(-d * 1.1);
    sky = mix(sky, cl, banks);
    // The ridge: two ranges, the nearer one darker.
    float far = 0.2 + 0.1 * fbm(vec2(p.x * 1.4 + 3.0, 0.0)) + 0.03 * noise2(vec2(p.x * 9.0, 2.0));
    float near = 0.1 + 0.09 * fbm(vec2(p.x * 2.1 + 11.0, 4.0)) + 0.02 * noise2(vec2(p.x * 14.0, 7.0));
    vec3 col = mix(sky, ink.rgb * 0.07 + accent.rgb * 0.05 * exp(-d * 3.0), smoothstep(0.004, -0.004, uv.y - far));
    col = mix(col, vec3(0.012, 0.013, 0.017), smoothstep(0.004, -0.004, uv.y - near));
    return col;
}

float keyOf(vec3 c) {
    return dot(c, vec3(0.299, 0.587, 0.114));
}

// Whether a place in the painted picture takes part in the sort.
bool sorts(vec2 uv, float asp, float cut) {
    float k = keyOf(painted(uv, asp));
    return darks ? k < cut : k > cut;
}

vec4 sortStep(int index, vec2 uv, float asp) {
    vec4 prev;
    if (index == 0) prev = IMG_NORM_PIXEL(sortD, uv);
    else if (index == 1) prev = IMG_NORM_PIXEL(sortA, uv);
    else if (index == 2) prev = IMG_NORM_PIXEL(sortB, uv);
    else prev = IMG_NORM_PIXEL(sortC, uv);

    float n = floor(vxCount + 0.5);
    float sw = clamp(vxSwell, 0.0, 1.0);
    // Louder, and more of the picture gives way.
    float cut = darks ? mix(0.02, 0.3, threshold) + 0.2 * sw : mix(0.7, 0.06, threshold) - 0.14 * sw;
    vec3 src = painted(uv, asp);
    bool mine = sorts(uv, asp, cut);

    // Along the sort: one buffer pixel up (or across).
    vec2 along = sideways ? vec2(1.0 / RENDERSIZE.x, 0.0) : vec2(0.0, 1.0 / RENDERSIZE.y);
    vec2 cell = floor(gl_FragCoord.xy);
    float line = sideways ? cell.y : cell.x;
    float at = sideways ? cell.x : cell.y;

    // A place outside the sort always shows the painted picture as it is now.
    if (!mine || FRAMEINDEX < 2) return vec4(src, 0.0);
    // Fresh picture is poured in when a place first joins the sort, and into some of the lines on a hit.
    bool again = hash11(line * 0.731 + n * 13.7) < repour && abs(prev.a - (n + 1.0)) > 0.5;
    if (prev.a < 0.5 || (index == 0 && again && n > 0.5)) return vec4(src, n + 1.0);

    // Which neighbor this pixel is paired with on this step.
    float parity = mod(at + float(index), 2.0);
    bool lower = parity < 0.5;
    vec2 other = uv + (lower ? along : -along);
    if (other.x < 0.0 || other.y < 0.0 || other.x > 1.0 || other.y > 1.0) return prev;
    if (!sorts(other, asp, cut)) return prev;
    vec4 mate;
    if (index == 0) mate = IMG_NORM_PIXEL(sortD, other);
    else if (index == 1) mate = IMG_NORM_PIXEL(sortA, other);
    else if (index == 2) mate = IMG_NORM_PIXEL(sortB, other);
    else mate = IMG_NORM_PIXEL(sortC, other);
    if (mate.a < 0.5) return prev;
    // Brighter rises (or runs right): the lower of a pair gives up the brighter color.
    float mk = keyOf(prev.rgb);
    float ok = keyOf(mate.rgb);
    bool swap = lower ? mk > ok : ok > mk;
    return swap ? vec4(mate.rgb, prev.a) : prev;
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy;
    // The frame's own shape; the sort buffers are half as wide and a third as tall.
    float asp = PASSINDEX < 4 ? (RENDERSIZE.x * 2.0) / (RENDERSIZE.y * 3.0) : RENDERSIZE.x / RENDERSIZE.y;

    if (PASSINDEX < 4) {
        gl_FragColor = sortStep(PASSINDEX, uv, asp);
        return;
    }

    // The picture: sorted where it sorts, painted elsewhere. Read on the buffer's own pixel centers along the
    // sort so the streaks keep their hard ends.
    vec2 size = floor(vec2(RENDERSIZE.x / 2.0, RENDERSIZE.y / 3.0));
    vec2 snapped = (floor(uv * size) + 0.5) / size;
    vec2 look = sideways ? vec2(snapped.x, uv.y) : vec2(uv.x, snapped.y);
    vec4 s = IMG_NORM_PIXEL(sortD, look);
    vec3 col = s.a > 0.5 ? s.rgb : painted(uv, asp);
    // A hit glints along the columns it poured again.
    float n = floor(vxCount + 0.5);
    float line = sideways ? floor(uv.y * size.y) : floor(uv.x * size.x);
    float poured = step(hash11(line * 0.731 + n * 13.7), repour) * step(0.5, n) * step(0.5, s.a);
    col += col * poured * clamp(vxPulse, 0.0, 1.0) * 0.2;

    vec2 vg = uv - 0.5;
    col *= 1.0 - 0.3 * dot(vg, vg) * 2.0;
    float lum = max(max(col.r, col.g), col.b);
    col = col / max(lum, 1e-4) * (1.0 - exp(-lum * 1.8));
    col += (hash21(gl_FragCoord.xy + fract(TIME) * 91.7) - 0.5) / 255.0;
    col = max(col, 0.0);

    vec3 outc = col;
    float outa = 1.0;
    if (vxClear) {
        // Only the sorted streaks are solid.
        outa = step(0.5, s.a) * clamp(max(max(col.r, col.g), col.b) * 1.6, 0.0, 1.0);
        outc = min(col, vec3(outa));
    }
    gl_FragColor = vec4(outc, outa) * vxPresence;
}
