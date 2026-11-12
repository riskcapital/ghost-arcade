/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "An old neon sign on a dark wall. Glass tubes are bent into a word (your own text, cycling through your phrases, or OPEN, LIVE, SIGNAL, NO SIGNAL, ERROR, ON AIR, LOVE or NIGHT) inside a frame, or into a pictogram (an arrow, a heart, a palm, a star or an eye), or both. Each tube has a hot core, a colored body, a glass rim and a glow that lights the plaster behind it. Blacked-out back tubes run between the letters, glass standoffs and clips hold them to the wall, and the feed tubes drop out of sight at the ends. A few tubes are failing: they stutter, light only part of the way or shimmer with moving bands of gas. Every hit of the sound it follows makes some letters buzz and chatter or surge brighter, and now and then one drops out for a moment. When the word or picture changes (each phrase, if set to change), the new one strikes up letter by letter. Sign picks words, pictures or both; Word and Picture pick which; Faults sets how many tubes are failing, Buzz how hard hits shake the power, Glow how far the light spreads and Tube width the thickness of the glass.",
    "PASSES": [
        {
            "TARGET": "clock",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 2, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "signStyle", "LABEL": "Sign", "TYPE": "long", "DEFAULT": 0, "VALUES": [0, 1, 2], "LABELS": ["Word", "Picture", "Picture and word"] },
        { "NAME": "word", "LABEL": "Word", "TYPE": "long", "DEFAULT": 0, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8], "LABELS": ["Changes each phrase", "OPEN", "LIVE", "SIGNAL", "NO SIGNAL", "ERROR", "ON AIR", "LOVE", "NIGHT"] },
        { "NAME": "pictogram", "LABEL": "Picture", "TYPE": "long", "DEFAULT": 0, "VALUES": [0, 1, 2, 3, 4, 5], "LABELS": ["Changes each phrase", "Arrow", "Heart", "Palm", "Star", "Eye"] },
        { "NAME": "faults", "LABEL": "Faults", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0, "MAX": 1 },
        { "NAME": "buzz", "LABEL": "Buzz", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "glow", "LABEL": "Glow", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "tubeWidth", "LABEL": "Tube width", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Letters", "TYPE": "color", "DEFAULT": [1.0, 0.72, 0.36, 1.0] },
        { "NAME": "accent", "LABEL": "Frame and picture", "TYPE": "color", "DEFAULT": [0.25, 0.9, 0.62, 1.0] },
        { "NAME": "vxHit", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxVel", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxBars", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 },
        { "NAME": "vxTxt0", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 262144 },
        { "NAME": "vxTxt1", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 262144 },
        { "NAME": "vxTxt2", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 262144 },
        { "NAME": "vxTxt3", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 262144 },
        { "NAME": "vxTxtLen", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 12 },
        { "NAME": "vxTxtId", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 16 },
        { "NAME": "vxTxtN", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 16 }
    ]
}*/

// clock (1x1): last count seen, seconds since the last hit, the phrase
// shown, seconds since it changed (for the strike-up).

const float TAU = 6.2831853;
const float PI = 3.14159265;
const float LW = 0.62;      // letter width, in cap heights
const float GAP = 0.3;      // space between letters
const int MAX_CHARS = 12;

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

float noise1(float x) {
    float i = floor(x);
    float f = fract(x);
    return mix(hash11(i), hash11(i + 1.0), f * f * (3.0 - 2.0 * f));
}

float noise2(vec2 x) {
    vec2 i = floor(x);
    vec2 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}

// Distance to a straight tube, with s the place along it (0-1).
vec2 seg(vec2 p, vec2 a, vec2 b) {
    vec2 ab = b - a;
    vec2 ap = p - a;
    float h = clamp(dot(ap, ab) / dot(ab, ab), 0.0, 1.0);
    return vec2(length(ap - ab * h), h);
}

// Distance to a bent tube: an arc round c of radius r from angle a0 through span.
vec2 arc(vec2 p, vec2 c, float r, float a0, float span) {
    vec2 q = p - c;
    float ang = atan(q.y, q.x);
    float rel = ang - a0;
    rel -= floor(rel / TAU) * TAU;
    if (rel <= span) return vec2(abs(length(q) - r), rel / span);
    vec2 e0 = c + r * vec2(cos(a0), sin(a0));
    vec2 e1 = c + r * vec2(cos(a0 + span), sin(a0 + span));
    float d0 = length(p - e0);
    float d1 = length(p - e1);
    return d0 < d1 ? vec2(d0, 0.0) : vec2(d1, 1.0);
}

// Keep the nearest stroke: x distance, y place along the whole letter, z stroke.
void take(inout vec3 b, vec2 ds, float k, float nk) {
    if (ds.x < b.x) b = vec3(ds.x, (k + ds.y) / nk, k);
}

// The words, packed six bits a letter, three letters a float, first letter lowest (x y z, then w);
// the length comes separately.
// Codes: 0 space, 1-26 A-Z, 27-36 0-9, then . ! ? - + ' : / & (37-45).
vec4 wordCode(float w) {
    if (w < 0.5) return vec4(21519.0, 14.0, 0.0, 0.0);       // OPEN
    if (w < 1.5) return vec4(90700.0, 5.0, 0.0, 0.0);        // LIVE
    if (w < 2.5) return vec4(29267.0, 49230.0, 0.0, 0.0);    // SIGNAL
    if (w < 3.5) return vec4(974.0, 29267.0, 49230.0, 0.0);  // NO SIGNAL
    if (w < 4.5) return vec4(74885.0, 1167.0, 0.0, 0.0);     // ERROR
    if (w < 5.5) return vec4(911.0, 74305.0, 0.0, 0.0);      // ON AIR
    if (w < 6.5) return vec4(91084.0, 5.0, 0.0, 0.0);        // LOVE
    return vec4(29262.0, 1288.0, 0.0, 0.0);                   // NIGHT
}

float wordLength(float w) {
    if (w < 1.5) return 4.0;
    if (w < 2.5) return 6.0;
    if (w < 3.5) return 9.0;
    if (w < 4.5) return 5.0;
    if (w < 5.5) return 6.0;
    if (w < 6.5) return 4.0;
    return 5.0;
}

float charAt(vec4 wc, float i) {
    float k = floor(i / 3.0);
    float packed = k < 0.5 ? wc.x : (k < 1.5 ? wc.y : (k < 2.5 ? wc.z : wc.w));
    float j = i - k * 3.0;
    float div = j < 0.5 ? 1.0 : (j < 1.5 ? 64.0 : 4096.0);
    return mod(floor(floor(packed + 0.5) / div), 64.0);
}

const float WM = 0.8;       // M and W are wider

float letterWidth(float c) {
    if (c < 0.5) return 0.35;                                   // space
    if (abs(c - 9.0) < 0.5) return 0.0;                         // I: one upright
    if (abs(c - 13.0) < 0.5 || abs(c - 23.0) < 0.5) return WM;  // M W
    if (abs(c - 28.0) < 0.5) return 0.36;                       // 1
    if (abs(c - 37.0) < 0.5 || abs(c - 38.0) < 0.5 || abs(c - 42.0) < 0.5 || abs(c - 43.0) < 0.5) return 0.0; // . ! ' :
    if (abs(c - 40.0) < 0.5) return 0.42;                       // -
    return LW;
}

// A tiny ring: reads as a dot of glass.
vec2 dot2(vec2 p, vec2 c) {
    return vec2(abs(length(p - c) - 0.02), 0.5);
}

// A letter of a plain rounded neon sans, built from tube strokes.
// q in cap heights, origin at the letter's bottom left.
vec3 letterTube(float c, vec2 q) {
    vec3 b = vec3(9.0, 0.0, 0.0);
    float W = LW;
    float r = W * 0.5;
    if (c < 0.5) return b;
    if (c < 1.5) {          // A
        float x = 0.36 * r;
        take(b, seg(q, vec2(0.0, 0.0), vec2(r, 1.0)), 0.0, 3.0);
        take(b, seg(q, vec2(r, 1.0), vec2(W, 0.0)), 1.0, 3.0);
        take(b, seg(q, vec2(x, 0.36), vec2(W - x, 0.36)), 2.0, 3.0);
    } else if (c < 2.5) {   // B
        float br = 0.25;
        take(b, seg(q, vec2(0.0, 0.0), vec2(0.0, 1.0)), 0.0, 6.0);
        take(b, seg(q, vec2(0.0, 1.0), vec2(W - br, 1.0)), 1.0, 6.0);
        take(b, arc(q, vec2(W - br, 0.75), br, -0.5 * PI, PI), 2.0, 6.0);
        take(b, seg(q, vec2(W - br, 0.5), vec2(0.0, 0.5)), 3.0, 6.0);
        take(b, arc(q, vec2(W - br, 0.25), br, -0.5 * PI, PI), 4.0, 6.0);
        take(b, seg(q, vec2(W - br, 0.0), vec2(0.0, 0.0)), 5.0, 6.0);
    } else if (c < 3.5) {   // C
        take(b, arc(q, vec2(r, 1.0 - r), r, 0.35, PI - 0.35), 0.0, 3.0);
        take(b, seg(q, vec2(0.0, 1.0 - r), vec2(0.0, r)), 1.0, 3.0);
        take(b, arc(q, vec2(r, r), r, PI, PI - 0.35), 2.0, 3.0);
    } else if (c < 4.5) {   // D
        take(b, seg(q, vec2(0.0, 0.0), vec2(0.0, 1.0)), 0.0, 6.0);
        take(b, seg(q, vec2(0.0, 1.0), vec2(W - r, 1.0)), 1.0, 6.0);
        take(b, arc(q, vec2(W - r, 1.0 - r), r, 0.0, 0.5 * PI), 2.0, 6.0);
        take(b, seg(q, vec2(W, 1.0 - r), vec2(W, r)), 3.0, 6.0);
        take(b, arc(q, vec2(W - r, r), r, -0.5 * PI, 0.5 * PI), 4.0, 6.0);
        take(b, seg(q, vec2(W - r, 0.0), vec2(0.0, 0.0)), 5.0, 6.0);
    } else if (c < 5.5) {   // E
        take(b, seg(q, vec2(W, 1.0), vec2(0.0, 1.0)), 0.0, 4.0);
        take(b, seg(q, vec2(0.0, 1.0), vec2(0.0, 0.0)), 1.0, 4.0);
        take(b, seg(q, vec2(0.0, 0.0), vec2(W, 0.0)), 2.0, 4.0);
        take(b, seg(q, vec2(0.0, 0.5), vec2(W * 0.78, 0.5)), 3.0, 4.0);
    } else if (c < 6.5) {   // F
        take(b, seg(q, vec2(W, 1.0), vec2(0.0, 1.0)), 0.0, 3.0);
        take(b, seg(q, vec2(0.0, 1.0), vec2(0.0, 0.0)), 1.0, 3.0);
        take(b, seg(q, vec2(0.0, 0.5), vec2(W * 0.78, 0.5)), 2.0, 3.0);
    } else if (c < 7.5) {   // G
        take(b, arc(q, vec2(r, 1.0 - r), r, 0.35, PI - 0.35), 0.0, 5.0);
        take(b, seg(q, vec2(0.0, 1.0 - r), vec2(0.0, r)), 1.0, 5.0);
        take(b, arc(q, vec2(r, r), r, PI, PI), 2.0, 5.0);
        take(b, seg(q, vec2(W, r), vec2(W, 0.46)), 3.0, 5.0);
        take(b, seg(q, vec2(W, 0.46), vec2(W * 0.5, 0.46)), 4.0, 5.0);
    } else if (c < 8.5) {   // H
        take(b, seg(q, vec2(0.0, 1.0), vec2(0.0, 0.0)), 0.0, 3.0);
        take(b, seg(q, vec2(0.0, 0.5), vec2(W, 0.5)), 1.0, 3.0);
        take(b, seg(q, vec2(W, 1.0), vec2(W, 0.0)), 2.0, 3.0);
    } else if (c < 9.5) {   // I
        take(b, seg(q, vec2(0.0, 1.0), vec2(0.0, 0.0)), 0.0, 1.0);
    } else if (c < 10.5) {  // J
        take(b, seg(q, vec2(W, 1.0), vec2(W, r)), 0.0, 2.0);
        take(b, arc(q, vec2(r, r), r, PI, PI), 1.0, 2.0);
    } else if (c < 11.5) {  // K
        take(b, seg(q, vec2(0.0, 1.0), vec2(0.0, 0.0)), 0.0, 3.0);
        take(b, seg(q, vec2(W, 1.0), vec2(0.0, 0.42)), 1.0, 3.0);
        take(b, seg(q, vec2(W * 0.3, 0.59), vec2(W, 0.0)), 2.0, 3.0);
    } else if (c < 12.5) {  // L
        take(b, seg(q, vec2(0.0, 1.0), vec2(0.0, 0.0)), 0.0, 2.0);
        take(b, seg(q, vec2(0.0, 0.0), vec2(W, 0.0)), 1.0, 2.0);
    } else if (c < 13.5) {  // M
        take(b, seg(q, vec2(0.0, 0.0), vec2(0.0, 1.0)), 0.0, 4.0);
        take(b, seg(q, vec2(0.0, 1.0), vec2(WM * 0.5, 0.38)), 1.0, 4.0);
        take(b, seg(q, vec2(WM * 0.5, 0.38), vec2(WM, 1.0)), 2.0, 4.0);
        take(b, seg(q, vec2(WM, 1.0), vec2(WM, 0.0)), 3.0, 4.0);
    } else if (c < 14.5) {  // N
        take(b, seg(q, vec2(0.0, 0.0), vec2(0.0, 1.0)), 0.0, 3.0);
        take(b, seg(q, vec2(0.0, 1.0), vec2(W, 0.0)), 1.0, 3.0);
        take(b, seg(q, vec2(W, 0.0), vec2(W, 1.0)), 2.0, 3.0);
    } else if (c < 15.5 || (c > 26.5 && c < 27.5) || (c > 16.5 && c < 17.5)) { // O, 0 (with a slash) and Q (with a tail)
        float nk = c < 15.5 ? 4.0 : 5.0;
        take(b, arc(q, vec2(r, 1.0 - r), r, 0.0, PI), 0.0, nk);
        take(b, seg(q, vec2(0.0, 1.0 - r), vec2(0.0, r)), 1.0, nk);
        take(b, arc(q, vec2(r, r), r, PI, PI), 2.0, nk);
        take(b, seg(q, vec2(W, r), vec2(W, 1.0 - r)), 3.0, nk);
        if (c > 26.5) take(b, seg(q, vec2(W * 0.22, 0.24), vec2(W * 0.78, 0.76)), 4.0, nk);
        else if (c > 15.5) take(b, seg(q, vec2(W * 0.55, 0.28), vec2(W * 1.05, -0.06)), 4.0, nk);
    } else if (c < 16.5 || (c > 17.5 && c < 18.5)) {  // P and R
        float br = 0.24;
        float isR = c > 17.5 ? 1.0 : 0.0;
        float nk = 4.0 + isR;
        take(b, seg(q, vec2(0.0, 0.0), vec2(0.0, 1.0)), 0.0, nk);
        take(b, seg(q, vec2(0.0, 1.0), vec2(W - br, 1.0)), 1.0, nk);
        take(b, arc(q, vec2(W - br, 1.0 - br), br, -0.5 * PI, PI), 2.0, nk);
        take(b, seg(q, vec2(W - br, 0.52), vec2(0.0, 0.52)), 3.0, nk);
        if (isR > 0.5) take(b, seg(q, vec2(W * 0.42, 0.52), vec2(W, 0.0)), 4.0, nk);
    } else if (c < 19.5) {  // S
        float sr = 0.25;
        take(b, arc(q, vec2(r, 0.75), sr, 0.35, 1.5 * PI - 0.35), 0.0, 2.0);
        take(b, arc(q, vec2(r, 0.25), sr, PI + 0.35, 1.5 * PI - 0.35), 1.0, 2.0);
    } else if (c < 20.5) {  // T
        take(b, seg(q, vec2(0.0, 1.0), vec2(W, 1.0)), 0.0, 2.0);
        take(b, seg(q, vec2(r, 1.0), vec2(r, 0.0)), 1.0, 2.0);
    } else if (c < 21.5) {  // U
        take(b, seg(q, vec2(0.0, 1.0), vec2(0.0, r)), 0.0, 3.0);
        take(b, arc(q, vec2(r, r), r, PI, PI), 1.0, 3.0);
        take(b, seg(q, vec2(W, r), vec2(W, 1.0)), 2.0, 3.0);
    } else if (c < 22.5) {  // V
        take(b, seg(q, vec2(0.0, 1.0), vec2(r, 0.0)), 0.0, 2.0);
        take(b, seg(q, vec2(r, 0.0), vec2(W, 1.0)), 1.0, 2.0);
    } else if (c < 23.5) {  // W
        take(b, seg(q, vec2(0.0, 1.0), vec2(WM * 0.25, 0.0)), 0.0, 4.0);
        take(b, seg(q, vec2(WM * 0.25, 0.0), vec2(WM * 0.5, 0.62)), 1.0, 4.0);
        take(b, seg(q, vec2(WM * 0.5, 0.62), vec2(WM * 0.75, 0.0)), 2.0, 4.0);
        take(b, seg(q, vec2(WM * 0.75, 0.0), vec2(WM, 1.0)), 3.0, 4.0);
    } else if (c < 24.5) {  // X
        take(b, seg(q, vec2(0.0, 0.0), vec2(W, 1.0)), 0.0, 2.0);
        take(b, seg(q, vec2(0.0, 1.0), vec2(W, 0.0)), 1.0, 2.0);
    } else if (c < 25.5) {  // Y
        take(b, seg(q, vec2(0.0, 1.0), vec2(r, 0.5)), 0.0, 3.0);
        take(b, seg(q, vec2(W, 1.0), vec2(r, 0.5)), 1.0, 3.0);
        take(b, seg(q, vec2(r, 0.5), vec2(r, 0.0)), 2.0, 3.0);
    } else if (c < 26.5) {  // Z
        take(b, seg(q, vec2(0.0, 1.0), vec2(W, 1.0)), 0.0, 3.0);
        take(b, seg(q, vec2(W, 1.0), vec2(0.0, 0.0)), 1.0, 3.0);
        take(b, seg(q, vec2(0.0, 0.0), vec2(W, 0.0)), 2.0, 3.0);
    } else if (c < 28.5) {  // 1
        take(b, seg(q, vec2(0.0, 0.78), vec2(0.3, 1.0)), 0.0, 2.0);
        take(b, seg(q, vec2(0.3, 1.0), vec2(0.3, 0.0)), 1.0, 2.0);
    } else if (c < 29.5) {  // 2
        float a0 = -0.6;
        vec2 e = vec2(r, 1.0 - r) + r * vec2(cos(a0), sin(a0));
        take(b, arc(q, vec2(r, 1.0 - r), r, a0, PI - a0), 0.0, 3.0);
        take(b, seg(q, e, vec2(0.0, 0.0)), 1.0, 3.0);
        take(b, seg(q, vec2(0.0, 0.0), vec2(W, 0.0)), 2.0, 3.0);
    } else if (c < 30.5) {  // 3
        take(b, arc(q, vec2(r, 0.75), 0.25, -0.5 * PI, 1.25 * PI), 0.0, 2.0);
        take(b, arc(q, vec2(r, 0.25), 0.25, -0.75 * PI, 1.25 * PI), 1.0, 2.0);
    } else if (c < 31.5) {  // 4
        take(b, seg(q, vec2(W * 0.72, 0.0), vec2(W * 0.72, 1.0)), 0.0, 3.0);
        take(b, seg(q, vec2(W * 0.72, 1.0), vec2(0.0, 0.32)), 1.0, 3.0);
        take(b, seg(q, vec2(0.0, 0.32), vec2(W, 0.32)), 2.0, 3.0);
    } else if (c < 32.5) {  // 5
        vec2 cc = vec2(W * 0.48, 0.3);
        float a1 = 0.8 * PI;
        take(b, seg(q, vec2(W, 1.0), vec2(W * 0.08, 1.0)), 0.0, 3.0);
        take(b, seg(q, vec2(W * 0.08, 1.0), cc + 0.3 * vec2(cos(a1), sin(a1))), 1.0, 3.0);
        take(b, arc(q, cc, 0.3, -0.8 * PI, 1.6 * PI), 2.0, 3.0);
    } else if (c < 33.5) {  // 6
        take(b, seg(q, vec2(W * 0.8, 1.0), vec2(0.02, 0.36)), 0.0, 2.0);
        take(b, arc(q, vec2(r, 0.3), 0.3, 0.0, TAU), 1.0, 2.0);
    } else if (c < 34.5) {  // 7
        take(b, seg(q, vec2(0.0, 1.0), vec2(W, 1.0)), 0.0, 2.0);
        take(b, seg(q, vec2(W, 1.0), vec2(W * 0.3, 0.0)), 1.0, 2.0);
    } else if (c < 35.5) {  // 8
        take(b, arc(q, vec2(r, 0.76), 0.24, 0.0, TAU), 0.0, 2.0);
        take(b, arc(q, vec2(r, 0.27), 0.27, 0.0, TAU), 1.0, 2.0);
    } else if (c < 36.5) {  // 9
        take(b, arc(q, vec2(r, 0.7), 0.3, 0.0, TAU), 0.0, 2.0);
        take(b, seg(q, vec2(W - 0.01, 0.66), vec2(W * 0.25, 0.0)), 1.0, 2.0);
    } else if (c < 37.5) {  // .
        take(b, dot2(q, vec2(0.0, 0.03)), 0.0, 1.0);
    } else if (c < 38.5) {  // !
        take(b, seg(q, vec2(0.0, 1.0), vec2(0.0, 0.28)), 0.0, 2.0);
        take(b, dot2(q, vec2(0.0, 0.03)), 1.0, 2.0);
    } else if (c < 39.5) {  // ?
        take(b, arc(q, vec2(r, 0.74), 0.26, -0.5 * PI, 1.5 * PI), 0.0, 3.0);
        take(b, seg(q, vec2(r, 0.48), vec2(r, 0.28)), 1.0, 3.0);
        take(b, dot2(q, vec2(r, 0.03)), 2.0, 3.0);
    } else if (c < 40.5) {  // -
        take(b, seg(q, vec2(0.0, 0.48), vec2(0.42, 0.48)), 0.0, 1.0);
    } else if (c < 41.5 || c > 44.5) {  // + (and & drawn as a plus)
        take(b, seg(q, vec2(0.0, 0.48), vec2(W, 0.48)), 0.0, 2.0);
        take(b, seg(q, vec2(r, 0.18), vec2(r, 0.78)), 1.0, 2.0);
    } else if (c < 42.5) {  // '
        take(b, seg(q, vec2(0.0, 1.0), vec2(0.0, 0.72)), 0.0, 1.0);
    } else if (c < 43.5) {  // :
        take(b, dot2(q, vec2(0.0, 0.2)), 0.0, 2.0);
        take(b, dot2(q, vec2(0.0, 0.62)), 1.0, 2.0);
    } else {                // /
        take(b, seg(q, vec2(0.0, 0.0), vec2(W, 1.0)), 0.0, 1.0);
    }
    return b;
}

// Pictograms, in units of their own height, centred: a is the accent tube, b the ink tube.
void picture(float k, vec2 q, out vec3 a, out vec3 b) {
    a = vec3(9.0, 0.0, 0.0);
    b = vec3(9.0, 0.0, 0.0);
    if (k < 0.5) {
        // Arrow: a bent shaft with a head, and chevrons chasing it.
        take(a, seg(q, vec2(-0.42, -0.28), vec2(-0.42, 0.02)), 0.0, 5.0);
        take(a, arc(q, vec2(-0.3, 0.02), 0.12, PI * 0.5, PI * 0.5), 1.0, 5.0);
        take(a, seg(q, vec2(-0.3, 0.14), vec2(0.36, 0.14)), 2.0, 5.0);
        take(a, seg(q, vec2(0.42, 0.14), vec2(0.24, 0.3)), 3.0, 5.0);
        take(a, seg(q, vec2(0.42, 0.14), vec2(0.24, -0.02)), 4.0, 5.0);
        for (int i = 0; i < 3; i++) {
            float x = -0.12 + float(i) * 0.15;
            take(b, seg(q, vec2(x, -0.12), vec2(x + 0.07, -0.2)), float(i) * 2.0, 6.0);
            take(b, seg(q, vec2(x + 0.07, -0.2), vec2(x, -0.28)), float(i) * 2.0 + 1.0, 6.0);
        }
    } else if (k < 1.5) {
        // Heart, with a smaller one inside.
        for (int hh = 0; hh < 2; hh++) {
            float sc = hh == 0 ? 1.0 : 0.5;
            vec2 qs = q / sc - vec2(0.0, hh == 0 ? 0.0 : 0.04);
            vec3 h = vec3(9.0, 0.0, 0.0);
            vec2 cl = vec2(-0.155, 0.11);
            vec2 cr2 = vec2(0.155, 0.11);
            float rr = 0.165;
            take(h, arc(qs, cl, rr, 0.0, 1.25 * PI), 0.0, 4.0);
            take(h, seg(qs, cl + rr * vec2(-0.7071, -0.7071), vec2(0.0, -0.4)), 1.0, 4.0);
            take(h, seg(qs, vec2(0.0, -0.4), cr2 + rr * vec2(0.7071, -0.7071)), 2.0, 4.0);
            take(h, arc(qs, cr2, rr, -0.25 * PI, 1.25 * PI), 3.0, 4.0);
            h.x *= sc;
            if (hh == 0) a = h;
            else b = h;
        }
    } else if (k < 2.5) {
        // Palm: a leaning trunk, drooping fronds, a setting sun and the sea.
        vec2 top = vec2(0.188, 0.169);
        take(a, arc(q, vec2(0.75, -0.4), 0.8, 2.35, 0.79), 0.0, 6.0);
        take(a, arc(q, top + vec2(-0.2, -0.09), 0.22, 0.42, 1.6), 1.0, 6.0);
        take(a, arc(q, top + vec2(0.2, -0.09), 0.22, 1.12, 1.6), 2.0, 6.0);
        take(a, arc(q, top + vec2(-0.26, -0.2), 0.33, 0.656, 1.3), 3.0, 6.0);
        take(a, arc(q, top + vec2(0.26, -0.2), 0.33, 1.186, 1.3), 4.0, 6.0);
        take(b, arc(q, vec2(-0.22, -0.36), 0.15, 0.0, PI), 0.0, 3.0);
        take(b, seg(q, vec2(-0.46, -0.36), vec2(0.46, -0.36)), 1.0, 3.0);
        take(b, seg(q, vec2(-0.3, -0.43), vec2(0.3, -0.43)), 2.0, 3.0);
    } else if (k < 3.5) {
        // Star: a five-point outline and a ring.
        for (int i = 0; i < 10; i++) {
            float fi = float(i);
            float a0 = fi * TAU / 10.0 + PI * 0.5;
            float a1 = a0 + TAU / 10.0;
            float r0 = mod(fi, 2.0) < 0.5 ? 0.34 : 0.14;
            float r1 = mod(fi, 2.0) < 0.5 ? 0.14 : 0.34;
            take(b, seg(q, r0 * vec2(cos(a0), sin(a0)), r1 * vec2(cos(a1), sin(a1))), fi, 10.0);
        }
        take(a, arc(q, vec2(0.0), 0.42, PI * 0.5 + 0.2, TAU - 0.4), 0.0, 1.0);
    } else {
        // Eye: almond lids, an iris and a pupil.
        float ry = 0.42;
        float cy = 0.27;
        float hspan = asin(0.38 / ry);
        take(b, arc(q, vec2(0.0, -cy), ry, PI * 0.5 - hspan, 2.0 * hspan), 0.0, 2.0);
        take(b, arc(q, vec2(0.0, cy), ry, PI * 1.5 - hspan, 2.0 * hspan), 1.0, 2.0);
        take(a, arc(q, vec2(0.0), 0.11, 0.0, TAU), 0.0, 2.0);
        take(a, arc(q, vec2(0.0), 0.035, 0.0, TAU), 1.0, 2.0);
        for (int i = 0; i < 5; i++) {
            float x = (float(i) - 2.0) * 0.13;
            float ly = sqrt(max(ry * ry - x * x, 0.0)) - cy;
            take(b, seg(q, vec2(x, ly + 0.03), vec2(x * 1.25, ly + 0.1)), 2.0, 3.0);
        }
    }
}

// How brightly one tube burns: steady, failing, striking up, or buzzing from a hit.
float tubeLight(float id, float along, float dist, float R, float t, float n, float age, float epoch, float strike, float order) {
    float lit = 1.0;
    float shimmer = 1.0 + 0.04 * sin(along * 40.0 - t * 9.0 + id);
    if (hash21(vec2(id + 0.37, epoch)) < faults * (id > 199.5 ? 0.12 : 0.4)) {
        float nz = noise1(t * 7.0 + id * 9.1);
        float stutter = smoothstep(0.3, 0.36, nz) * (0.75 + 0.25 * step(0.5, hash11(floor(t * 23.0) + id)));
        // Partly lit: the gas only reaches part way along the tube.
        float reach = 0.35 + 0.65 * noise1(t * 1.3 + id * 3.7);
        float part = smoothstep(reach, reach - 0.04, along);
        part = mix(part, reach, smoothstep(R, R * 6.0, dist));
        lit = mix(part * 0.6, 1.0, stutter * step(0.5, hash11(id + 2.0))) * mix(0.4, 1.0, stutter);
        shimmer = 1.0 + 0.3 * sin(along * 70.0 - t * 22.0 + id) * (1.0 - stutter);
    }
    // Strike-up: each piece catches in turn, with a couple of false starts.
    float on = strike - order * 0.09;
    if (on < 0.35) lit *= on < 0.0 ? 0.0 : step(0.55, hash21(vec2(floor(on * 30.0), id))) * 0.8;
    // The frame rides out hits; the letters and pictures take them.
    if (id < 199.5 && age < 0.4 && hash21(vec2(id * 1.13, n)) < (0.15 + 0.35 * clamp(vxVel, 0.0, 1.0)) * buzz) {
        float chatter = step(0.42, hash21(vec2(floor(age * 55.0), id + n)));
        lit *= mix(1.0, chatter, smoothstep(0.4, 0.15, age));
        lit *= 1.0 + 0.7 * exp(-age / 0.06) * hash11(id + n);
    }
    // Now and then a hit knocks a whole piece out for a moment.
    if (id < 199.5 && age < 0.45 && hash21(vec2(id + 3.3, n)) < 0.18 * buzz) lit *= step(0.45, hash21(vec2(floor(age * 32.0), id + n)));
    return lit * shimmer;
}

void main() {
    float n = floor(vxCount + 0.5);
    float bars = floor(vxBars + 0.5);
    // Your own text: its phrase number marks a change (the strike-up), else every four bars.
    bool custom = vxTxtLen > 0.5;
    float phrase = custom ? 1000.0 + floor(vxTxtId + 0.5) : floor(bars / 4.0);

    if (PASSINDEX == 0) {
        vec4 c = IMG_NORM_PIXEL(clock, vec2(0.5));
        float dt = clamp(TIMEDELTA, 0.0, 0.1);
        if (FRAMEINDEX < 2) c = vec4(n, 30.0, phrase, 0.0);
        bool newHit = abs(n - c.r) > 0.5;
        float age = newHit ? 0.0 : min(c.g + dt, 30.0);
        bool newPhrase = abs(phrase - c.b) > 0.5;
        float since = newPhrase ? 0.0 : min(c.a + dt, 30.0);
        gl_FragColor = vec4(n, age, phrase, since);
        return;
    }

    vec4 clk = IMG_NORM_PIXEL(clock, vec2(0.5));
    float age = FRAMEINDEX < 2 ? 30.0 : clk.g;
    if (vxHit > 0.01) age = min(age, (1.0 - clamp(vxHit, 0.0, 1.0)) * 0.1);
    if (n < 0.5) age = 30.0;
    float strike = FRAMEINDEX < 2 ? 30.0 : clk.a;

    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
    vec2 fwp = fwidth(gl_FragCoord.xy);
    float px = max(1.0, max(fwp.x, fwp.y)) / RENDERSIZE.y;
    p *= max(1.0, 1.62 / aspect);

    float t = vxPhase;
    float epoch = phrase;
    float R = mix(0.0045, 0.012, tubeWidth);
    float gl = mix(0.4, 1.6, glow);
    float sag = 1.0 - 0.12 * buzz * exp(-age / 0.15);
    bool hasWord = signStyle != 1;
    bool hasPic = signStyle != 0;
    // Strike-up only when the sign is set to change.
    bool changes = (hasWord && (custom ? vxTxtN > 1.5 : word == 0)) || (hasPic && pictogram == 0);
    if (!changes) strike = 30.0;

    float wi = custom ? phrase : (word == 0 ? mod(phrase, 8.0) : float(word - 1));
    float pk = pictogram == 0 ? mod((custom ? floor(bars / 4.0) : phrase) + 1.0, 5.0) : float(pictogram - 1);
    vec4 wc = custom ? vec4(vxTxt0, vxTxt1, vxTxt2, vxTxt3) : wordCode(wi);
    float len = custom ? min(floor(vxTxtLen + 0.5), 12.0) : wordLength(wi);

    // Layout: the word's width in cap heights, then a scale that fits the frame.
    float total = 0.0;
    for (int i = 0; i < MAX_CHARS; i++) {
        if (float(i) >= len) break;
        total += letterWidth(charAt(wc, float(i))) + (float(i) < len - 1.0 ? GAP : 0.0);
    }
    float picW = hasPic ? (hasWord ? 0.42 : 0.62) : 0.0;
    float cap = hasWord ? min(hasPic ? 0.26 : 0.32, (hasPic ? 0.92 : 1.36) / max(total, 1.0)) : 0.0;
    float wordW = total * cap;
    float gapPW = hasPic && hasWord ? 0.1 : 0.0;
    float fullW = wordW + picW + gapPW;
    float x0 = -fullW * 0.5;
    vec2 picC = vec2(x0 + picW * 0.5, 0.01);
    vec2 wordO = vec2(x0 + picW + gapPW, -cap * 0.5);

    vec3 tubes = vec3(0.0);
    vec3 halo = vec3(0.0);
    vec3 hazeCol = vec3(0.0);
    float rim = 0.0;
    vec3 dead = vec3(0.0);
    float glass = 0.0;
    float reach = R * 14.0;

    // The word.
    if (hasWord) {
        float xo = 0.0;
        vec2 prevEnd = vec2(0.0);
        for (int i = 0; i < MAX_CHARS; i++) {
            float fi = float(i);
            if (fi >= len) break;
            float c = charAt(wc, fi);
            float w = letterWidth(c);
            vec2 org = wordO + vec2(xo * cap, 0.0);
            vec2 cen = org + vec2(w * cap * 0.5, cap * 0.5);
            // Wall wash from each letter (cheap blobs, so it has no seams).
            if (c > 0.5) {
                vec2 dq = (p - cen) / vec2(max(w, 0.3) * cap * 0.9 + 0.05, cap * 0.85);
                hazeCol += ink.rgb * exp(-dot(dq, dq)) * 0.06;
            }
            // Back tube: the blacked-out run from this letter's foot to the next one's.
            vec2 foot = org + vec2(0.0, -0.06 * cap);
            if (fi > 0.5 && c > 0.5) {
                vec2 ds = seg(p, prevEnd, foot);
                glass = max(glass, smoothstep(1.05, 0.7, ds.x / R));
                rim = max(rim, exp(-pow(abs(ds.x / R - 0.85) / 0.12, 2.0)));
                // A glass standoff holds the back tube to the wall.
                vec2 mid = mix(prevEnd, foot, 0.5);
                float sd = length(p - mid) / (R * 2.4);
                glass = max(glass, smoothstep(1.0, 0.8, sd) * 0.7);
                rim = max(rim, exp(-pow(abs(sd - 0.9) / 0.12, 2.0)) * 0.8);
            }
            if (c > 0.5) prevEnd = org + vec2(w * cap, -0.06 * cap);
            xo += w + GAP;
            if (c < 0.5) continue;
            if (p.x < org.x - reach || p.x > org.x + w * cap + reach || p.y < org.y - reach || p.y > org.y + cap + reach) continue;
            vec3 b = letterTube(c, (p - org) / cap);
            float d = b.x * cap;
            float id = fi * 7.0 + c + wi * 31.0;
            float lit = tubeLight(id, b.y, d, R, t, n, age, epoch, strike, fi) * sag;
            vec3 col = ink.rgb;
            float x = d / R;
            float core = exp(-x * x * 3.5);
            float body = smoothstep(1.05, 0.7, x);
            vec3 hot = mix(col, vec3(1.0), 0.55);
            tubes = max(tubes, (hot * core * 0.9 + col * body * 0.55) * lit);
            dead = max(dead, col * body * clamp(1.0 - lit, 0.0, 1.0));
            halo += col * lit * gl * (0.32 * exp(-d / (R * 1.4)) + 0.09 * exp(-d / (R * 5.0)));
            float rr = (x - 0.88) / 0.1;
            rim = max(rim, exp(-rr * rr));
        }
        // Feed tubes: from the first and last letters down through the wall.
        float firstX = wordO.x;
        float lastX = wordO.x + wordW;
        vec2 ds0 = seg(p, wordO + vec2(0.0, -0.06 * cap), vec2(firstX, -0.42));
        vec2 ds1 = seg(p, vec2(lastX, wordO.y - 0.06 * cap), vec2(lastX, -0.42));
        float dd = min(ds0.x, ds1.x);
        glass = max(glass, smoothstep(1.05, 0.7, dd / R) * smoothstep(-0.42, -0.36, p.y));
        rim = max(rim, exp(-pow(abs(dd / R - 0.85) / 0.12, 2.0)) * smoothstep(-0.42, -0.3, p.y));
    }

    // The picture.
    if (hasPic) {
        float ph = hasWord ? 0.42 : 0.62;
        vec2 q = (p - picC) / ph;
        vec3 a;
        vec3 b;
        if (abs(q.x) < 0.7 && abs(q.y) < 0.7) {
            picture(pk, q, a, b);
            for (int part = 0; part < 2; part++) {
                vec3 tb = part == 0 ? a : b;
                vec3 col = part == 0 ? accent.rgb : ink.rgb;
                float d = tb.x * ph;
                float id = 100.0 + pk * 5.0 + float(part) * 2.0 + tb.z;
                float lit = tubeLight(id, tb.y, d, R, t, n, age, epoch, strike, float(part) * 2.0) * sag;
                float x = d / R;
                float core = exp(-x * x * 3.5);
                float body = smoothstep(1.05, 0.7, x);
                vec3 hot = mix(col, vec3(1.0), 0.55);
                tubes = max(tubes, (hot * core * 0.9 + col * body * 0.55) * lit);
                dead = max(dead, col * body * clamp(1.0 - lit, 0.0, 1.0));
                halo += col * lit * gl * (0.32 * exp(-d / (R * 1.4)) + 0.09 * exp(-d / (R * 5.0)));
                float rr = (x - 0.88) / 0.1;
                rim = max(rim, exp(-rr * rr));
            }
        }
        vec2 dq = (p - picC) / (ph * 0.55);
        hazeCol += mix(accent.rgb, ink.rgb, 0.3) * exp(-dot(dq, dq)) * 0.08;
    }

    // The frame: one rounded tube round the whole sign, held by four standoffs.
    {
        vec2 hb = vec2(fullW * 0.5 + 0.08, (hasWord ? max(cap, hasPic ? 0.42 : 0.0) : 0.62) * 0.5 + 0.08);
        vec2 fc = vec2(0.0, hasWord && !hasPic ? 0.0 : 0.01);
        float cr = 0.07;
        vec2 e = abs(p - fc) - hb + cr;
        float sdb = length(max(e, 0.0)) + min(max(e.x, e.y), 0.0) - cr;
        float d = abs(sdb);
        vec2 fq = p - fc;
        float along = fract(atan(fq.y, fq.x) / TAU + 0.25);
        float lit = tubeLight(200.0, along, d, R, t, n, age, epoch, strike, -1.0) * sag;
        vec3 col = accent.rgb;
        float x = d / R;
        float core = exp(-x * x * 3.5);
        float body = smoothstep(1.05, 0.7, x);
        vec3 hot = mix(col, vec3(1.0), 0.55);
        tubes = max(tubes, (hot * core * 0.9 + col * body * 0.55) * lit);
        dead = max(dead, col * body * clamp(1.0 - lit, 0.0, 1.0));
        halo += col * lit * gl * (0.32 * exp(-d / (R * 1.4)) + 0.09 * exp(-d / (R * 5.0)) + 0.02 * exp(-d / (R * 22.0)));
        float rr = (x - 0.88) / 0.1;
        rim = max(rim, exp(-rr * rr));
        // Standoffs at the four corners.
        vec2 sp = abs(p - fc) - (hb - vec2(cr * 0.3));
        float sd = length(sp) / (R * 2.4);
        glass = max(glass, smoothstep(1.0, 0.8, sd) * 0.7);
        rim = max(rim, exp(-pow(abs(sd - 0.9) / 0.12, 2.0)) * 0.8);
    }

    // The wall: rough plaster that only shows where the light falls on it.
    float wall = 0.55 + 0.45 * noise2(p * 140.0) * (0.6 + 0.4 * noise2(p * 13.0));
    vec3 lightOnWall = (hazeCol * gl + halo * 0.35) * wall;
    vec3 col = tubes + halo * 0.8 + lightOnWall;
    // Dark glass (unlit tubes, back tubes, standoffs) catches a little of the light.
    float spill = clamp(dot(halo + hazeCol * 3.0, vec3(0.33)), 0.0, 1.0);
    col = mix(col, col * 0.35 + vec3(0.02), glass * (1.0 - step(0.02, dot(tubes, vec3(1.0)))));
    col += vec3(0.85, 0.9, 1.0) * rim * (0.05 + 0.25 * spill) + dead * 0.1;

    col = col / (1.0 + max(max(col.r, col.g), col.b) * 0.3);
    col += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0;
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
