/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A vector display. Each note writes its name in single beam strokes, large in the middle of the screen, the beam burning brighter where it stops at every corner. As newer notes arrive the older words shrink and drift back into depth along a slow spiral, a tunnel of words fading into the phosphor. The newest word's beam head is the accent.",
    "PASSES": [
        {
            "TARGET": "notesB",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {
            "TARGET": "notesA",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {
            "TARGET": "seen",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {
            "TARGET": "phosphor",
            "PERSISTENT": true,
            "FLOAT": true
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 6, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "wordSet", "LABEL": "Words", "TYPE": "long", "DEFAULT": 0, "VALUES": [0, 1, 2], "LABELS": ["Note names", "Frequencies", "Words"] },
        { "NAME": "glyphSize", "LABEL": "Glyph size", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "persistence", "LABEL": "Persistence", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "depthDrift", "LABEL": "Depth drift", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "beamWidth", "LABEL": "Beam width", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "jitter", "LABEL": "Jitter", "TYPE": "float", "DEFAULT": 0.25, "MIN": 0, "MAX": 1 },
        { "NAME": "spiral", "LABEL": "Spiral", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "dwell", "LABEL": "Corner dwell", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "writeTime", "LABEL": "Write time", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Beam", "TYPE": "color", "DEFAULT": [0.75, 1.0, 0.92, 1.0] },
        { "NAME": "accent", "LABEL": "Beam head", "TYPE": "color", "DEFAULT": [1.0, 0.45, 0.12, 1.0] },
        { "NAME": "vxHit", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxVel", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPitch", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// State lives in 1x1 targets, one vec4 each, so nothing is resampled.
// notesA = the four newest words' MIDI notes, newest first (0 = none).
// notesB = the next three, then seconds since the newest note.
// seen = the note count as of last frame.
// phosphor: r = the beams' afterglow, g = the beam head's.

// The font: single strokes on a 4 by 6 grid, one vec4 per segment (x0, y0, x1, y1).
const int SEG_COUNT = 131;
const vec4 SEGS[131] = vec4[131](
    vec4(0.0, 0.0, 4.0, 0.0), vec4(4.0, 0.0, 4.0, 6.0), vec4(4.0, 6.0, 0.0, 6.0), vec4(0.0, 6.0, 0.0, 0.0),
    vec4(0.0, 0.0, 4.0, 6.0), vec4(1.0, 5.0, 2.0, 6.0), vec4(2.0, 6.0, 2.0, 0.0), vec4(0.0, 6.0, 4.0, 6.0),
    vec4(4.0, 6.0, 4.0, 3.0), vec4(4.0, 3.0, 0.0, 3.0), vec4(0.0, 3.0, 0.0, 0.0), vec4(0.0, 0.0, 4.0, 0.0),
    vec4(0.0, 6.0, 4.0, 6.0), vec4(4.0, 6.0, 4.0, 0.0), vec4(4.0, 0.0, 0.0, 0.0), vec4(0.0, 3.0, 4.0, 3.0),
    vec4(0.0, 6.0, 0.0, 3.0), vec4(0.0, 3.0, 4.0, 3.0), vec4(4.0, 6.0, 4.0, 0.0), vec4(4.0, 6.0, 0.0, 6.0),
    vec4(0.0, 6.0, 0.0, 3.0), vec4(0.0, 3.0, 4.0, 3.0), vec4(4.0, 3.0, 4.0, 0.0), vec4(4.0, 0.0, 0.0, 0.0),
    vec4(0.0, 6.0, 0.0, 0.0), vec4(0.0, 0.0, 4.0, 0.0), vec4(4.0, 0.0, 4.0, 3.0), vec4(4.0, 3.0, 0.0, 3.0),
    vec4(0.0, 6.0, 4.0, 6.0), vec4(4.0, 6.0, 4.0, 0.0), vec4(0.0, 0.0, 4.0, 0.0), vec4(4.0, 0.0, 4.0, 6.0),
    vec4(4.0, 6.0, 0.0, 6.0), vec4(0.0, 6.0, 0.0, 0.0), vec4(0.0, 3.0, 4.0, 3.0), vec4(4.0, 0.0, 4.0, 6.0),
    vec4(4.0, 6.0, 0.0, 6.0), vec4(0.0, 6.0, 0.0, 3.0), vec4(0.0, 3.0, 4.0, 3.0), vec4(0.0, 0.0, 0.0, 4.0),
    vec4(0.0, 4.0, 2.0, 6.0), vec4(2.0, 6.0, 4.0, 4.0), vec4(4.0, 4.0, 4.0, 0.0), vec4(0.0, 2.0, 4.0, 2.0),
    vec4(0.0, 0.0, 0.0, 6.0), vec4(0.0, 6.0, 3.0, 6.0), vec4(3.0, 6.0, 4.0, 5.0), vec4(4.0, 5.0, 4.0, 4.0),
    vec4(4.0, 4.0, 3.0, 3.0), vec4(3.0, 3.0, 4.0, 2.0), vec4(4.0, 2.0, 4.0, 1.0), vec4(4.0, 1.0, 3.0, 0.0),
    vec4(3.0, 0.0, 0.0, 0.0), vec4(0.0, 3.0, 3.0, 3.0), vec4(4.0, 0.0, 0.0, 0.0), vec4(0.0, 0.0, 0.0, 6.0),
    vec4(0.0, 6.0, 4.0, 6.0), vec4(0.0, 0.0, 0.0, 6.0), vec4(0.0, 6.0, 2.0, 6.0), vec4(2.0, 6.0, 4.0, 4.0),
    vec4(4.0, 4.0, 4.0, 2.0), vec4(4.0, 2.0, 2.0, 0.0), vec4(2.0, 0.0, 0.0, 0.0), vec4(4.0, 0.0, 0.0, 0.0),
    vec4(0.0, 0.0, 0.0, 6.0), vec4(0.0, 6.0, 4.0, 6.0), vec4(0.0, 3.0, 3.0, 3.0), vec4(0.0, 0.0, 0.0, 6.0),
    vec4(0.0, 6.0, 4.0, 6.0), vec4(0.0, 3.0, 3.0, 3.0), vec4(2.0, 2.0, 4.0, 2.0), vec4(4.0, 2.0, 4.0, 0.0),
    vec4(4.0, 0.0, 0.0, 0.0), vec4(0.0, 0.0, 0.0, 6.0), vec4(0.0, 6.0, 4.0, 6.0), vec4(4.0, 6.0, 4.0, 4.0),
    vec4(0.0, 0.0, 0.0, 6.0), vec4(4.0, 0.0, 4.0, 6.0), vec4(0.0, 3.0, 4.0, 3.0), vec4(0.0, 0.0, 4.0, 0.0),
    vec4(2.0, 0.0, 2.0, 6.0), vec4(0.0, 6.0, 4.0, 6.0), vec4(0.0, 6.0, 0.0, 0.0), vec4(0.0, 0.0, 4.0, 0.0),
    vec4(0.0, 0.0, 0.0, 6.0), vec4(0.0, 6.0, 2.0, 4.0), vec4(2.0, 4.0, 4.0, 6.0), vec4(4.0, 6.0, 4.0, 0.0),
    vec4(0.0, 0.0, 0.0, 6.0), vec4(0.0, 6.0, 4.0, 0.0), vec4(4.0, 0.0, 4.0, 6.0), vec4(0.0, 0.0, 0.0, 6.0),
    vec4(0.0, 6.0, 4.0, 6.0), vec4(4.0, 6.0, 4.0, 0.0), vec4(4.0, 0.0, 0.0, 0.0), vec4(0.0, 0.0, 0.0, 6.0),
    vec4(0.0, 6.0, 4.0, 6.0), vec4(4.0, 6.0, 4.0, 3.0), vec4(4.0, 3.0, 0.0, 3.0), vec4(0.0, 0.0, 0.0, 6.0),
    vec4(0.0, 6.0, 4.0, 6.0), vec4(4.0, 6.0, 4.0, 3.0), vec4(4.0, 3.0, 0.0, 3.0), vec4(1.0, 3.0, 4.0, 0.0),
    vec4(0.0, 0.0, 4.0, 0.0), vec4(4.0, 0.0, 4.0, 3.0), vec4(4.0, 3.0, 0.0, 3.0), vec4(0.0, 3.0, 0.0, 6.0),
    vec4(0.0, 6.0, 4.0, 6.0), vec4(0.0, 6.0, 4.0, 6.0), vec4(2.0, 6.0, 2.0, 0.0), vec4(0.0, 6.0, 0.0, 0.0),
    vec4(0.0, 0.0, 4.0, 0.0), vec4(4.0, 0.0, 4.0, 6.0), vec4(0.0, 6.0, 2.0, 0.0), vec4(2.0, 0.0, 4.0, 6.0),
    vec4(0.0, 6.0, 0.0, 0.0), vec4(0.0, 0.0, 2.0, 2.0), vec4(2.0, 2.0, 4.0, 0.0), vec4(4.0, 0.0, 4.0, 6.0),
    vec4(0.0, 6.0, 2.0, 3.0), vec4(2.0, 3.0, 4.0, 6.0), vec4(2.0, 3.0, 2.0, 0.0), vec4(0.0, 0.0, 0.0, 6.0),
    vec4(4.0, 6.0, 0.0, 3.0), vec4(0.0, 3.0, 4.0, 0.0), vec4(1.1, 1.0, 1.7, 5.0), vec4(2.5, 1.0, 3.1, 5.0),
    vec4(0.2, 2.3, 4.0, 2.3), vec4(0.2, 3.7, 4.0, 3.7), vec4(0.6, 3.0, 3.4, 3.0));
const int GLYPH_START[34] = int[34](0, 5, 7, 12, 16, 19, 24, 28, 30, 35, 39, 44, 54, 57, 63, 67, 70, 76, 79, 82, 84, 88, 91, 95, 99, 104, 109, 111, 114, 116, 120, 123, 126, 130);
const int GLYPH_SEGS[34] = int[34](5, 2, 5, 4, 3, 5, 4, 2, 5, 4, 5, 10, 3, 6, 4, 3, 6, 3, 3, 2, 4, 3, 4, 4, 5, 5, 2, 3, 2, 4, 3, 3, 4, 1);
// DUB BASS SUB ECHO LEAD TAPE WAVE TONE SINE SAW VOLT MONO SYNC KEYS LOOP GAIN
const ivec4 WORDS[16] = ivec4[16](ivec4(13, 27, 11, -1), ivec4(11, 10, 25, 25), ivec4(25, 27, 11, -1), ivec4(14, 12, 17, 22), ivec4(19, 14, 10, 13), ivec4(26, 10, 23, 14), ivec4(29, 10, 28, 14), ivec4(26, 22, 21, 14), ivec4(25, 18, 21, 14), ivec4(25, 10, 29, -1), ivec4(28, 22, 19, 26), ivec4(20, 22, 21, 22), ivec4(25, 30, 21, 12), ivec4(31, 14, 30, 25), ivec4(19, 22, 22, 23), ivec4(16, 10, 18, 21));

const int ENTRIES = 7;
// Glyph cell in grid units: 4 wide plus a gap.
const float ADVANCE = 6.2;
const float GAP = 2.2;

float hash11(float x) {
    float p = fract(x * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

float hash21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

// MIDI note of word k, newest first (0 = none).
float noteOf(int k, vec4 na, vec4 nb) {
    return k < 4 ? na[k] : (k < 7 ? nb[k - 4] : 0.0);
}

// The glyphs of one word (-1 = none): its note name, its frequency in hertz, or a word.
ivec4 wordGlyphs(float note, float seed) {
    ivec4 w = ivec4(-1);
    if (wordSet == 1) {
        float hz = floor(440.0 * exp2((note - 69.0) / 12.0) + 0.5);
        float digits = hz >= 1000.0 ? 4.0 : (hz >= 100.0 ? 3.0 : (hz >= 10.0 ? 2.0 : 1.0));
        for (int i = 0; i < 4; i++) {
            float fi = float(i);
            if (fi < digits) {
                w[i] = int(mod(floor(hz / pow(10.0, digits - 1.0 - fi) + 0.001), 10.0));
            }
        }
        return w;
    }
    if (wordSet == 2) {
        return WORDS[int(clamp(floor(seed * 16.0), 0.0, 15.0))];
    }
    float pc = mod(note, 12.0);
    float octave = clamp(floor(note / 12.0) - 1.0, 0.0, 9.0);
    // C C# D D# E F F# G G# A A# B, as glyph ids (A = 10 ... G = 16).
    int letter = pc < 1.5 ? 12 : (pc < 3.5 ? 13 : (pc < 4.5 ? 14 : (pc < 6.5 ? 15 : (pc < 8.5 ? 16 : (pc < 10.5 ? 10 : 11)))));
    bool sharp = pc == 1.0 || pc == 3.0 || pc == 6.0 || pc == 8.0 || pc == 10.0;
    w.x = letter;
    w.y = sharp ? 32 : int(octave);
    w.z = sharp ? int(octave) : -1;
    return w;
}

float wordLength(ivec4 w) {
    return w.w >= 0 ? 4.0 : (w.z >= 0 ? 3.0 : (w.y >= 0 ? 2.0 : 1.0));
}

// Beam light from one stroke a-b (both relative to the pixel, in stored pixels).
vec2 strokeAt(vec2 a, vec2 b, float sigma) {
    vec2 ab = b - a;
    float t = clamp(dot(-a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
    vec2 dv = -a - ab * t;
    return vec2(exp(-0.5 * dot(dv, dv) / (sigma * sigma)), t);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float dt = clamp(TIMEDELTA, 0.0, 0.1);
    float count = floor(vxCount + 0.5);

    // A note arrived since last frame: every word moves one place back.
    float lastSeen = IMG_NORM_PIXEL(seen, vec2(0.5)).r;
    bool ready = FRAMEINDEX >= 2;
    bool fresh = ready && count != lastSeen && vxPitch > 0.0;
    if (PASSINDEX == 0) {
        vec4 nb = IMG_NORM_PIXEL(notesB, vec2(0.5));
        vec4 na = IMG_NORM_PIXEL(notesA, vec2(0.5));
        vec4 v = vec4(nb.xyz, min(nb.w + dt, 30.0));
        if (fresh) v = vec4(na.w, nb.x, nb.y, 0.0);
        if (!ready) v = vec4(0.0, 0.0, 0.0, 30.0);
        gl_FragColor = v;
        return;
    }
    if (PASSINDEX == 1) {
        vec4 v = IMG_NORM_PIXEL(notesA, vec2(0.5));
        if (fresh) v = vec4(floor(vxPitch * 127.0 + 0.5), v.x, v.y, v.z);
        if (!ready) v = vec4(0.0);
        gl_FragColor = v;
        return;
    }
    if (PASSINDEX == 2) {
        gl_FragColor = vec4(count, 0.0, 0.0, 1.0);
        return;
    }

    vec2 fw = max(fwidth(gl_FragCoord.xy), vec2(1.0));
    // Stored pixels per frame-height unit, per axis.
    vec2 S = RENDERSIZE.y / fw;
    vec2 p = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;

    if (PASSINDEX == 3) {
        vec4 na = IMG_NORM_PIXEL(notesA, vec2(0.5));
        vec4 nb = IMG_NORM_PIXEL(notesB, vec2(0.5));
        float age = nb.w;
        float sigma = mix(0.45, 1.3, beamWidth);
        float dwellA = mix(0.0, 0.5, dwell);
        float dwellR = sigma * 2.2;
        float reach = max(sigma * 3.5, dwellR * 2.5);
        // Height of the newest word, in frame heights, and one grid unit of it.
        float H = mix(0.12, 0.4, glyphSize);
        float unit = H / 6.0;
        // Older words slide back one step over about a fifth of a second.
        float slide = smoothstep(0.0, 1.0, clamp(age / 0.22, 0.0, 1.0));
        float stepZ = mix(0.35, 1.4, depthDrift);
        float quiet = mix(1.0, 0.35, smoothstep(2.0, 8.0, age));
        // The newest word is written stroke by stroke, then the beam keeps retracing it.
        float writeT = mix(0.08, 0.6, writeTime);
        float beam = 0.0;
        float headGlow = 0.0;
        float turn = vxPhase * 0.05;

        for (int k = 0; k < ENTRIES; k++) {
            float fk = float(k);
            float note = noteOf(k, na, nb);
            if (note > 0.5) {
                // Each word keeps its own seed: its note and the count it arrived on.
                ivec4 w = wordGlyphs(note, hash11(note * 1.7 + mod(count - fk + 64.0, 64.0) * 7.13));
                float len = wordLength(w);
                float pos = k == 0 ? 0.0 : fk - 1.0 + slide;
                float z = 1.0 + pos * stepZ;
                // A slow spiral: each step back turns a little further round.
                float ang = 2.1 + pos * mix(0.4, 1.3, spiral) + turn;
                float rad = mix(0.35, 1.0, spiral) * smoothstep(0.0, 1.0, min(pos, 1.0)) * (1.0 + 0.2 * pos);
                vec2 centre = rad * vec2(cos(ang) * 1.5, sin(ang)) / z;
                float scale = unit / z;
                // Vector-display wobble.
                centre += jitter * 0.0018 * vec2(sin(vxPhase * 23.0 + fk * 5.1) + 0.6 * sin(vxPhase * 41.0 + fk * 2.3),
                                                 cos(vxPhase * 19.0 + fk * 3.7) + 0.6 * cos(vxPhase * 37.0 + fk * 1.9));
                float width = len * ADVANCE - GAP;
                vec2 origin = centre - scale * vec2(width, 6.0) * 0.5;
                // The word's box, in stored pixels, before looking at any stroke.
                vec2 lo = (origin - p) * S;
                vec2 hi = (origin + scale * vec2(width, 6.0) - p) * S;
                bool near = lo.x < reach && lo.y < reach && hi.x > -reach && hi.y > -reach;
                float level = exp(-pos * mix(0.55, 0.3, depthDrift)) * quiet;
                if (k == 0) level *= 1.0 + 0.5 * vxHit * vxHit;
                float total = 0.0;
                for (int c = 0; c < 4; c++) {
                    if (w[c] >= 0) total += float(GLYPH_SEGS[w[c]]);
                }
                // Strokes drawn so far: all of them, except while the newest is being written.
                float drawn = k == 0 ? (age / writeT) * total : 1e4;
                // The beam head: while writing it leads the pen; afterwards it laps the word.
                float headAt = age < writeT ? drawn : fract((age - writeT) / max(0.9, total * 0.06)) * total;
                if (near) {
                    float j = 0.0;
                    for (int c = 0; c < 4; c++) {
                        int gid = w[c];
                        if (gid >= 0) {
                            vec2 o = origin + vec2(float(c) * ADVANCE * scale, 0.0);
                            int s0 = GLYPH_START[gid];
                            int n = GLYPH_SEGS[gid];
                            for (int s = 0; s < 10; s++) {
                                if (s < n && j < drawn) {
                                    vec4 sg = SEGS[s0 + s];
                                    vec2 a = (o + sg.xy * scale - p) * S;
                                    vec2 b = (o + sg.zw * scale - p) * S;
                                    float part = clamp(drawn - j, 0.0, 1.0);
                                    b = mix(a, b, part);
                                    vec2 st = strokeAt(a, b, sigma);
                                    // The beam rests a moment at each end, so corners bloom.
                                    float ends = exp(-dot(a, a) / (dwellR * dwellR)) + (part > 0.999 ? exp(-dot(b, b) / (dwellR * dwellR)) : 0.0);
                                    beam = max(beam, (st.x + dwellA * ends) * level);
                                    if (k == 0) {
                                        // Head: a short stretch of stroke just behind the beam.
                                        float behind = headAt - (j + st.y * part);
                                        float tail = behind >= 0.0 && behind < 0.7 ? 1.0 - behind / 0.7 : 0.0;
                                        headGlow = max(headGlow, st.x * tail * tail);
                                    }
                                }
                                if (s < n) j += 1.0;
                            }
                        }
                    }
                }
            }
        }

        // With no words yet, a resting beam: a short dash under the middle.
        if (na.x < 0.5) {
            vec2 a = (vec2(-0.025, -0.06) - p) * S;
            vec2 b = (vec2(0.025, -0.06) - p) * S;
            float dash = strokeAt(a, b, sigma).x + dwellA * (exp(-dot(a, a) / (dwellR * dwellR)) + exp(-dot(b, b) / (dwellR * dwellR)));
            beam = max(beam, dash * (0.4 + 0.12 * sin(vxPhase * 2.0)));
        }

        vec4 prev = IMG_NORM_PIXEL(phosphor, uv);
        float f60 = dt * 60.0;
        float keep = pow(mix(0.45, 0.93, persistence), f60);
        float glow = max(prev.r * keep - 0.002 * f60, beam);
        float hg = max(prev.g * pow(0.6, f60) - 0.004 * f60, headGlow);
        if (FRAMEINDEX < 2) {
            glow = 0.0;
            hg = 0.0;
        }
        gl_FragColor = vec4(max(glow, 0.0), max(hg, 0.0), 0.0, 1.0);
        return;
    }

    vec4 ph = IMG_NORM_PIXEL(phosphor, uv);
    vec3 col = ink.rgb * (1.0 - exp(-ph.r * 1.7));
    col += vec3(0.9, 0.9, 0.85) * max(ph.r - 1.3, 0.0) * 0.12;
    col = mix(col, accent.rgb * 1.1, clamp(1.0 - exp(-ph.g * 2.2), 0.0, 1.0));
    col += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0;
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
