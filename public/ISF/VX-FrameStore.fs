/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A low-resolution frame store in the manner of an early digital video buffer. Two ramp shapes drift slowly through the live picture; every hit of the sound it follows writes the bright parts of it into the store as coarse blocks, and the output keys the live picture over the held blocks, so the frame is half live and half remembered. Held blocks step down through grey levels as they fade, and every few hits the whole frame holds still for a beat.",
    "PASSES": [
        {
            "TARGET": "hitState",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {
            "TARGET": "tempo",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {
            "TARGET": "store",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": "$WIDTH/2",
            "HEIGHT": "$HEIGHT/2"
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 3, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "blocks", "LABEL": "Blocks across", "TYPE": "float", "DEFAULT": 56, "MIN": 32, "MAX": 96 },
        { "NAME": "keyLevel", "LABEL": "Key threshold", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0.05, "MAX": 0.95 },
        { "NAME": "holdDecay", "LABEL": "Hold decay", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "liveMix", "LABEL": "Live mix", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0, "MAX": 1 },
        { "NAME": "levels", "LABEL": "Posterise levels", "TYPE": "float", "DEFAULT": 4, "MIN": 2, "MAX": 8 },
        { "NAME": "freezeEvery", "LABEL": "Freeze every", "TYPE": "long", "DEFAULT": 8, "VALUES": [0, 4, 8, 16], "LABELS": ["Never", "4th hit", "8th hit", "16th hit"] },
        { "NAME": "motion", "LABEL": "Motion", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "shapeSize", "LABEL": "Shape size", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Ink", "TYPE": "color", "DEFAULT": [0.75, 1.0, 0.92, 1.0] },
        { "NAME": "accent", "LABEL": "Newest blocks", "TYPE": "color", "DEFAULT": [1.0, 0.45, 0.12, 1.0] },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxBeat", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

float hash21(vec2 q) {
    vec3 p3 = fract(vec3(q.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

// The live picture: two ramp shapes (a cone and a turning square pyramid)
// drifting on slow paths. Returns luma 0-1.
float livePicture(vec2 uv, float aspect) {
    float t = vxPhase * mix(0.4, 3.0, motion);
    vec2 q = (uv - 0.5) * vec2(aspect, 1.0);
    float size = mix(0.6, 1.5, shapeSize);
    vec2 c1 = vec2(0.42 * sin(t * 0.37 + 0.6), 0.2 * sin(t * 0.53 + 1.0));
    vec2 c2 = vec2(0.46 * sin(t * 0.29 + 3.4), 0.22 * cos(t * 0.41 + 0.3));
    float l1 = clamp(1.0 - length(q - c1) / (0.3 * size), 0.0, 1.0);
    float a = t * 0.15;
    vec2 d = q - c2;
    d = vec2(cos(a) * d.x - sin(a) * d.y, sin(a) * d.x + cos(a) * d.y);
    float l2 = clamp(1.0 - max(abs(d.x), abs(d.y)) / (0.24 * size), 0.0, 1.0);
    return max(l1, l2 * 0.9);
}

float posterise(float l, float n) {
    return floor(l * n + 0.5) / n;
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    float n = floor(vxCount + 0.5);
    float dt = clamp(TIMEDELTA, 0.0, 0.1);
    float nLev = floor(levels + 0.5);
    float every = floor(freezeEvery + 0.5);

    // hitState: r the count, g seconds since the hit, b 1 on the frame of a hit,
    // a 1 if that hit freezes the frame.
    if (PASSINDEX == 0) {
        vec4 prev = IMG_NORM_PIXEL(hitState, vec2(0.5));
        if (FRAMEINDEX < 2) prev = vec4(n, 30.0, 0.0, 0.0);
        vec4 v = vec4(prev.r, min(prev.g + dt, 30.0), 0.0, prev.a);
        if (abs(n - prev.r) > 0.5) {
            float frz = (every > 0.5 && mod(n, every) < 0.5) ? 1.0 : 0.0;
            v = vec4(n, 0.0, 1.0, frz);
        }
        gl_FragColor = v;
        return;
    }
    // tempo: the beat clock's last position and the measured seconds per beat.
    vec4 tp = IMG_NORM_PIXEL(tempo, vec2(0.5));
    if (PASSINDEX == 1) {
        float s = (FRAMEINDEX < 2 || tp.g < 0.1) ? 0.5 : tp.g;
        float step01 = mod(vxBeat - tp.r + 1.0, 1.0);
        if (FRAMEINDEX >= 2 && dt > 0.0 && step01 > 0.0005 && step01 < 0.3) {
            s = mix(s, clamp(dt / step01, 0.25, 1.4), 1.0 - exp(-dt / 0.6));
        }
        gl_FragColor = vec4(vxBeat, s, 0.0, 1.0);
        return;
    }

    // Square blocks, so many across.
    float across = floor(blocks + 0.5);
    vec2 bsz = vec2(1.0 / across, aspect / across);
    vec2 bid = floor(uv / bsz);
    vec2 bc = (bid + 0.5) * bsz;
    vec4 hs = IMG_NORM_PIXEL(hitState, vec2(0.5));
    float thr = keyLevel;

    // store: per block, r the held luma, g how fresh the capture is. Every pixel
    // of a block reads and writes the block centre, so the blocks stay exact.
    if (PASSINDEX == 2) {
        vec4 s = IMG_NORM_PIXEL(store, bc);
        float tau = mix(0.35, 5.0, holdDecay * holdDecay);
        s.r *= exp(-dt / tau);
        s.g *= exp(-dt / 0.09);
        if (hs.b > 0.5) {
            float l = livePicture(bc, aspect);
            if (hs.a > 0.5) s = vec4(posterise(l, nLev), 0.0, 0.0, 1.0);
            else if (l > thr * 0.7) s = vec4(posterise(max(l, thr * 0.7 + 0.5 / nLev), nLev), s.r < 0.01 ? 1.0 : 0.0, 0.0, 1.0);
        }
        // Whatever has faded below the first grey level is gone.
        if (s.r < 0.5 / nLev) s.r = 0.0;
        if (FRAMEINDEX < 2) s = vec4(0.0);
        gl_FragColor = vec4(s.rg, 0.0, 1.0);
        return;
    }

    vec2 fw = max(fwidth(gl_FragCoord.xy), vec2(0.001));
    float live = livePicture(uv, aspect);
    // Live picture in posterised greys, with clean band edges.
    float q = live * nLev;
    float qw = max(fwidth(q), 1e-4);
    float band = (floor(q) + smoothstep(1.0 - qw, 1.0, fract(q))) / nLev;
    // The live picture is drawn as thin contours at its grey steps over a dim fill,
    // so it reads apart from the solid blocks of the store.
    float fq = fract(q);
    float contour = 1.0 - smoothstep(0.0, 1.5 * qw, min(fq, 1.0 - fq));
    float liveLum = mix(band * 0.18, band * 0.6 + 0.4, contour);
    float key = smoothstep(thr - qw / nLev, thr + qw / nLev, live);

    // Held blocks, read at their centres, with a one-pixel gutter between them.
    vec4 s = IMG_NORM_PIXEL(store, bc);
    float held = floor(s.r * nLev + 0.5) / nLev;
    vec2 inB = fract(uv / bsz);
    vec2 g = fw / RENDERSIZE / bsz;
    float gutter = step(g.x, inB.x) * step(g.y, inB.y);
    held *= gutter;

    // A freeze shows only the store for one beat after its hit.
    float spb = clamp(tp.g > 0.1 ? tp.g : 0.5, 0.25, 1.4);
    float frozen = (hs.a > 0.5 && hs.g < spb) ? 1.0 : 0.0;
    float liveShown = key * (1.0 - frozen);

    float lum = liveShown * liveLum * liveMix + (1.0 - liveShown) * held * 0.75;
    float fresh = clamp(s.g, 0.0, 1.0) * (1.0 - liveShown) * gutter * step(0.01, held);
    vec3 col = ink.rgb * lum;
    col = mix(col, accent.rgb * max(held, 0.5), fresh * 0.9);

    float lit = max(col.r, max(col.g, col.b));
    col += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0 * step(0.004, lit);
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
