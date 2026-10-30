/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "Interference gratings. Each sounding note lays a fine grating of light lines, straight or in rings, its line frequency set by the note's pitch, each slowly turning. Where gratings overlap they beat into moire fringes: near-unison notes make slow, wide fringes, wider intervals fine dense ones, and the fringes sweep as the gratings turn. The accent marks the points where every grating meets.",
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 7, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "gratingType", "LABEL": "Gratings", "TYPE": "long", "DEFAULT": 1, "VALUES": [0, 1], "LABELS": ["Straight", "Rings"] },
        { "NAME": "baseFreq", "LABEL": "Base frequency", "TYPE": "float", "DEFAULT": 44, "MIN": 16, "MAX": 80 },
        { "NAME": "intervalScale", "LABEL": "Interval scale", "TYPE": "float", "DEFAULT": 0.25, "MIN": 0.05, "MAX": 1 },
        { "NAME": "rotation", "LABEL": "Rotation", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0, "MAX": 1 },
        { "NAME": "lineWidth", "LABEL": "Line width", "TYPE": "float", "DEFAULT": 0.2, "MIN": 0, "MAX": 1 },
        { "NAME": "contrast", "LABEL": "Fringe contrast", "TYPE": "float", "DEFAULT": 0.9, "MIN": 0, "MAX": 1 },
        { "NAME": "drift", "LABEL": "Drift", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "spread", "LABEL": "Spread", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "aperture", "LABEL": "Aperture", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Lines", "TYPE": "color", "DEFAULT": [0.75, 1.0, 0.92, 1.0] },
        { "NAME": "accent", "LABEL": "Meeting points", "TYPE": "color", "DEFAULT": [1.0, 0.45, 0.12, 1.0] },
        { "NAME": "vxEnv", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxHit", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxNote0", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNote1", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNote2", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNote3", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNoteE0", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNoteE1", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNoteE2", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNoteE3", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

const float TAU = 6.2831853;

float hash21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

// The sounding notes, lowest first. Column i = (MIDI note, energy, weight, unused).
// Notes far quieter than the loudest are let go, so a released chord makes way.
mat4 chordNotes() {
    float emax = max(max(vxNoteE0, vxNoteE1), max(vxNoteE2, vxNoteE3));
    float gate = max(0.002, 0.3 * emax);
    vec2 a = vec2((vxNote0 > 0.0 && vxNoteE0 >= gate) ? floor(vxNote0 * 127.0 + 0.5) : 999.0, vxNoteE0);
    vec2 b = vec2((vxNote1 > 0.0 && vxNoteE1 >= gate) ? floor(vxNote1 * 127.0 + 0.5) : 999.0, vxNoteE1);
    vec2 c = vec2((vxNote2 > 0.0 && vxNoteE2 >= gate) ? floor(vxNote2 * 127.0 + 0.5) : 999.0, vxNoteE2);
    vec2 d = vec2((vxNote3 > 0.0 && vxNoteE3 >= gate) ? floor(vxNote3 * 127.0 + 0.5) : 999.0, vxNoteE3);
    vec2 t;
    if (b.x < a.x) { t = a; a = b; b = t; }
    if (d.x < c.x) { t = c; c = d; d = t; }
    if (c.x < a.x) { t = a; a = c; c = t; }
    if (d.x < b.x) { t = b; b = d; d = t; }
    if (c.x < b.x) { t = b; b = c; c = t; }
    float e = max(emax, 1e-4);
    vec4 n0 = vec4(a.x, a.y, a.x < 998.0 ? smoothstep(0.3, 0.6, a.y / e) : 0.0, 0.0);
    vec4 n1 = vec4(b.x, b.y, b.x < 998.0 ? smoothstep(0.3, 0.6, b.y / e) : 0.0, 0.0);
    vec4 n2 = vec4(c.x, c.y, c.x < 998.0 ? smoothstep(0.3, 0.6, c.y / e) : 0.0, 0.0);
    vec4 n3 = vec4(d.x, d.y, d.x < 998.0 ? smoothstep(0.3, 0.6, d.y / e) : 0.0, 0.0);
    return mat4(n0, n1, n2, n3);
}

// The phase of grating i at p: lines sit at whole numbers.
// g = (lines per frame height, angle, offset, ring centre angle). Rings sit
// round a small circle, so two of them interfere like two sources.
float gratingPhase(vec2 p, vec4 g, float orbit) {
    if (gratingType == 1) {
        vec2 c = orbit * vec2(cos(g.w), sin(g.w));
        return g.x * length(p - c) + g.z;
    }
    return g.x * dot(p, vec2(cos(g.y), sin(g.y))) + g.z;
}

// A thin line at every whole phase, measured in stored pixels. Lines that crowd
// closer than a few stored pixels fade to their mean light, so they never alias.
float lineAt(float ph, float fwPh, float halfW) {
    float fw = max(fwPh, 1e-5);
    float d = abs(fract(ph + 0.5) - 0.5) / fw;
    float core = clamp(halfW + 0.5 - d, 0.0, 1.0);
    float spacing = 1.0 / fw;
    return mix(min(1.0, 2.0 * halfW / spacing), core, smoothstep(2.5, 5.0, spacing));
}

void main() {
    vec2 p = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
    float r = length(p);
    mat4 ch = chordNotes();
    float emax = max(max(vxNoteE0, vxNoteE1), max(vxNoteE2, vxNoteE3));
    float master = smoothstep(0.0, 0.15, emax);
    float hit2 = vxHit * vxHit;

    // Line frequency rises with pitch. Interval scale compresses the steps
    // between notes (1 = true frequency ratios), so near-unison notes beat in
    // wide slow fringes and wider intervals in finer ones. The root's pitch
    // class nudges the whole set up by up to half an octave.
    float root = ch[0].z > 0.0 ? ch[0].x : 60.0;
    float k0 = baseFreq * exp2(mod(root, 12.0) / 24.0);
    float spin = vxPhase * rotation * 0.012;
    float spreadA = mix(0.004, 0.45, spread * spread);
    float slide = -vxPhase * drift * 0.35;
    float orbit = mix(0.004, 0.2, spread * spread);

    // Three note gratings, then two faint resting ones that hold the frame when
    // nothing sounds: nearly the same frequency, so they beat in wide slow bands.
    vec4 g[5];
    float w[5];
    for (int i = 0; i < 3; i++) {
        vec4 n = ch[i];
        float iv = n.x - root;
        // Notes far above the root fold down an octave so the lines stay resolvable.
        iv = iv > 19.0 ? iv - 12.0 : iv;
        iv *= intervalScale;
        float fi = float(i);
        float turn = spin * (fi == 0.0 ? 1.0 : (fi == 1.0 ? -0.63 : 0.41));
        float ang = 0.35 + (fi == 1.0 ? spreadA : (fi == 2.0 ? -0.7 * spreadA : 0.0)) + turn;
        g[i] = vec4(k0 * exp2(iv / 12.0), ang, slide * (1.0 + 0.37 * fi), 2.2 + fi * 2.0944 + turn * 6.0);
        w[i] = n.z * master;
    }
    // The densest grating keeps at least eight stored pixels per line: the whole
    // set scales down together, so the ratios (and the fringes) survive.
    vec2 fwPx = fwidth(gl_FragCoord.xy);
    float storedRows = RENDERSIZE.y / max(max(fwPx.x, fwPx.y), 1.0);
    float kTop = max(max(g[0].x * step(0.001, w[0]), g[1].x * step(0.001, w[1])), max(g[2].x * step(0.001, w[2]), baseFreq * 1.14));
    float fit = min(1.0, storedRows / 8.0 / kTop);
    for (int i = 0; i < 3; i++) {
        g[i].x *= fit;
    }
    float rest = 1.0 - master;
    g[3] = vec4(baseFreq * 1.12 * fit, 0.35 + spin, slide * 0.6, 2.2 + spin * 6.0);
    g[4] = vec4(baseFreq * 1.12 * 1.012 * fit, 0.35 + 0.012 + spin * 0.8, slide * 0.45, 2.2 + 3.1416 + spin * 6.0);
    w[3] = rest * 0.45;
    w[4] = rest * 0.45;

    float halfW = mix(0.3, 1.1, lineWidth);
    float light = 0.0;
    float meet = 1.0;
    float notes = 0.0;
    float ph[5];
    float fw[5];
    for (int i = 0; i < 5; i++) {
        ph[i] = gratingPhase(p, g[i], orbit);
        fw[i] = fwidth(ph[i]);
    }
    for (int i = 0; i < 5; i++) {
        if (w[i] > 0.001) {
            light += w[i] * lineAt(ph[i], fw[i], halfW);
        }
        if (i < 3 && w[i] > 0.05) {
            meet *= lineAt(ph[i], fw[i], halfW + 0.6);
            notes += 1.0;
        }
    }

    // The fringes: where the gratings' lines fall together the light gathers,
    // where they interleave it thins.
    float bsum = 0.0;
    float bw = 0.0;
    for (int i = 0; i < 5; i++) {
        for (int j = 0; j < 5; j++) {
            if (j > i && w[i] > 0.001 && w[j] > 0.001 && (i < 3) == (j < 3)) {
                float pw = w[i] * w[j];
                bsum += pw * cos(TAU * (ph[i] - ph[j]));
                bw += pw;
            }
        }
    }
    float together = bw > 1e-4 ? 0.5 + 0.5 * bsum / bw : 1.0;
    float fringe = mix(1.0, pow(together, 3.0), contrast);
    light *= fringe;

    // A round aperture with a soft rim holds the gratings in the frame.
    float ap = mix(0.3, 0.62, aperture);
    float win = 1.0 - smoothstep(ap * 0.72, ap, r);

    float level = mix(0.55, 1.0, smoothstep(0.0, 0.5, vxEnv)) * (1.0 + 0.35 * hit2);
    vec3 col = ink.rgb * (1.0 - exp(-light * 1.5 * level)) * win;
    // The accent: every grating meeting at the heart of a bright fringe.
    float meeting = notes > 1.5 ? meet * smoothstep(0.86, 0.98, together) : 0.0;
    col = mix(col, accent.rgb * level, clamp(meeting * win * master, 0.0, 1.0));

    col += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0;
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
