/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "An analog video synth patch played by the notes. Oscillators running in raster time make bars whose count follows the pitch; two notes beat against each other, a chord weaves a plaid. A shape ramp goes through a wavefolder and a soft keyer, a colourizer bands it, and a little frame feedback smears it.",
    "PASSES": [
        {
            "TARGET": "trail",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": "$WIDTH/2",
            "HEIGHT": "$HEIGHT/2"
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 10, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "oscMix", "LABEL": "Oscillator mix", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0, "MAX": 1 },
        { "NAME": "density", "LABEL": "Bar density", "TYPE": "float", "DEFAULT": 1, "MIN": 0.25, "MAX": 3 },
        { "NAME": "folds", "LABEL": "Fold stages", "TYPE": "float", "DEFAULT": 3, "MIN": 1, "MAX": 6 },
        { "NAME": "keyLevel", "LABEL": "Key threshold", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "keySoft", "LABEL": "Key softness", "TYPE": "float", "DEFAULT": 0.2, "MIN": 0, "MAX": 1 },
        { "NAME": "bands", "LABEL": "Colour bands", "TYPE": "float", "DEFAULT": 4, "MIN": 2, "MAX": 8 },
        { "NAME": "feedback", "LABEL": "Feedback", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "rotate", "LABEL": "Loop rotate", "TYPE": "float", "DEFAULT": 0.2, "MIN": -1, "MAX": 1 },
        { "NAME": "zoom", "LABEL": "Loop zoom", "TYPE": "float", "DEFAULT": 0.35, "MIN": -1, "MAX": 1 },
        { "NAME": "drift", "LABEL": "Drift", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Ink", "TYPE": "color", "DEFAULT": [0.75, 1.0, 0.92, 1.0] },
        { "NAME": "accent", "LABEL": "Accent", "TYPE": "color", "DEFAULT": [1.0, 0.45, 0.12, 1.0] },
        { "NAME": "vxEnv", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxHit", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxGlide", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNote0", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNote1", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNote2", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNote3", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNoteE0", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNoteE1", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNoteE2", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNoteE3", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 }
    ]
}*/

const float TAU = 6.2831853;
// One field of interlaced video.
const float FIELD_LINES = 262.5;

float hash21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

// Bars across the frame for a note: proportional to 2^((note-36)/12).
float barsFor(float note) {
    return density * 3.0 * exp2((note * 127.0 - 36.0) / 12.0);
}

// An H-rate oscillator, nearly locked to the line rate. In raster time its
// phase is k * (line + along); whole cycles per line drop out, leaving
// k * along plus the detune times the line: bars that lean by the detune.
float hPhase(float note, float lineIdx, float along, float roll) {
    float k = barsFor(note);
    float detune = k - floor(k + 0.5);
    return k * (along - 0.5) + detune * lineIdx * (0.4 + 2.6 * drift) / FIELD_LINES + roll;
}

// A V-rate oscillator: kv cycles per field, so its phase is kv * beam time / lines.
float vPhase(float note, float beamT, float aspect, float roll) {
    float kv = barsFor(note) / aspect;
    return kv * (beamT / FIELD_LINES - 0.5) + roll;
}

// A thin line at each crest of a phase. `tailAmt` adds the smear a
// bandwidth-limited signal leaves after each edge, along the scanline only.
float crest(float ph, float tailAmt) {
    float fw = max(fwidth(ph), 1e-5);
    float f = fract(ph);
    float d = min(f, 1.0 - f) / fw;
    float core = 1.0 - smoothstep(0.35, 1.25, d);
    return core + tailAmt * exp(-f / (fw * 7.0));
}

// The patch, in colour, at one point of the frame.
vec3 synthPatch(vec2 uv, float fillAmt) {
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    float clock = vxPhase * (0.15 + drift);

    // Beam time: which line the beam is on (top first) plus how far along it.
    float lineIdx = (1.0 - uv.y) * FIELD_LINES;
    float along = uv.x;
    float beamT = lineIdx + along;

    // The strongest note is the root; the others sort by pitch so a held
    // chord keeps its gratings in place. Empty slots sort last.
    float n0 = vxNote0 > 0.001 ? vxNote0 : 2.0;
    float n1 = vxNote1 > 0.001 ? vxNote1 : 2.0;
    float n2 = vxNote2 > 0.001 ? vxNote2 : 2.0;
    float n3 = vxNote3 > 0.001 ? vxNote3 : 2.0;
    float e0 = vxNoteE0; float e1 = vxNoteE1; float e2 = vxNoteE2; float e3 = vxNoteE3;
    float t;
    if (n2 < n1) { t = n1; n1 = n2; n2 = t; t = e1; e1 = e2; e2 = t; }
    if (n3 < n2) { t = n2; n2 = n3; n3 = t; t = e2; e2 = e3; e3 = t; }
    if (n2 < n1) { t = n1; n1 = n2; n2 = t; t = e1; e1 = e2; e2 = t; }
    e0 *= step(n0, 1.5); e1 *= step(n1, 1.5); e2 *= step(n2, 1.5); e3 *= step(n3, 1.5);
    n0 = min(n0, 0.85); n1 = min(n1, 0.85); n2 = min(n2, 0.85); n3 = min(n3, 0.85);
    float level = clamp(e0 + e1 + e2 + e3, 0.0, 1.0);
    // Released notes fade out of the patch quickly; held ones stay bright.
    float a0 = smoothstep(0.08, 0.5, e0);
    float a1 = smoothstep(0.15, 0.55, e1);
    float a2 = smoothstep(0.15, 0.55, e2);
    float a3 = smoothstep(0.15, 0.55, e3);

    // The shape ramp: a circle easing towards a diamond and back.
    vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
    float morph = 0.5 + 0.5 * sin(clock * 0.09);
    float ramp = mix(length(p), (abs(p.x) + abs(p.y)) * 0.78, morph * 0.8);

    // Wavefolder: the ramp folded into stages. A hit kicks the fold phase outward.
    float stages = floor(folds + 0.5);
    float kick = vxHit * vxHit * 0.12;
    // A triangle fold with slightly rounded corners, like an analog folder.
    float fu = fract(ramp * 1.15 * stages - clock * 0.06 - kick) - 0.5;
    float folded = clamp(1.0 - 2.0 * sqrt(fu * fu + 0.0008), 0.0, 1.0);

    // The folded ramp bends the oscillators: their phase is pushed by it, so
    // the bars break into chevrons along every fold.
    float bend = (0.3 + 0.55 * vxEnv) * (0.6 + 0.4 * level);

    // Oscillators. H: the root and one more note of a chord, two gratings
    // that beat into a moire. V: the other notes, crossing them into a plaid.
    float ph0 = hPhase(n0, lineIdx, along, clock * 0.11) + bend * folded;
    float ph2 = hPhase(n2, lineIdx, along, -clock * 0.07) + bend * folded;
    float pv1 = vPhase(n1, beamT, aspect, clock * 0.05) + bend * 0.35 * folded;
    float pv3 = vPhase(n3, beamT, aspect, -clock * 0.04) + bend * 0.35 * folded;
    // Radial oscillator: rings from the centre at the root's pitch.
    float rph = barsFor(n0) * 0.15 * ramp - clock * 0.08 + bend * 0.5 * folded;

    // Soft keyer: cuts the shape out of black. Its source is the ramp,
    // scalloped by the folds; the envelope opens it.
    float keySrc = 1.0 - ramp / 0.85 + 0.3 * folded;
    float thr = clamp(keyLevel + 0.24 - 0.36 * vxEnv, 0.02, 0.98);
    float soft = 0.01 + keySoft * 0.3;
    float key = smoothstep(thr - soft, thr + soft, keySrc);

    // Colourizer: the keyed brightness in bands with smooth edges. The
    // lowest band is the accent, the rest step up through the ink.
    float lum = key * (0.2 + 0.8 * folded);
    float nb = floor(bands + 0.5);
    float q = lum * nb;
    float qw = max(fwidth(q), 0.03);
    float stepped = (floor(q) + smoothstep(0.5 - qw, 0.5 + qw, fract(q))) / nb;
    float lowBand = key * (1.0 - smoothstep(1.0 - qw, 1.0 + qw, q));
    vec3 tone = ink.rgb * stepped * (1.0 - lowBand) + accent.rgb * 0.7 * lowBand;

    // The oscillators drawn as thin lines, lit through the colourizer. The
    // mixer sweeps the root from H (bars) through V (lines) to radial (rings);
    // the other notes of a chord always add their own gratings.
    float pv0 = vPhase(n0, beamT, aspect, clock * 0.05) + bend * 0.35 * folded;
    float wH = clamp(1.0 - oscMix * 2.0, 0.0, 1.0);
    float wV = 1.0 - abs(oscMix * 2.0 - 1.0);
    float wR = clamp(oscMix * 2.0 - 1.0, 0.0, 1.0);
    float rootLines = a0 * (wH * crest(ph0, 0.07) + wV * crest(pv0, 0.0) + wR * crest(rph, 0.0));
    float chordLines = a2 * 0.8 * crest(ph2, 0.07) + a1 * crest(pv1, 0.0) + a3 * 0.8 * crest(pv3, 0.0);
    float oscLines = rootLines + chordLines;
    // At rest a faint grating at the last pitch keeps the patch alive.
    float restNote = vxGlide > 0.05 ? clamp(vxGlide + 0.05, 0.4, 0.62) : 0.55;
    float restPh = hPhase(restNote, lineIdx, along, clock * 0.05) + 0.45 * folded;
    oscLines += (1.0 - level) * 0.55 * crest(restPh, 0.07);

    // A note onset flashes the lines in the accent.
    vec3 lineTone = mix(tone, accent.rgb * stepped, vxHit * vxHit * 0.7);
    float idle = 0.45 + 0.55 * clamp(vxEnv * 1.5, 0.0, 1.0);
    return lineTone * oscLines * idle + tone * key * 0.02 * fillAmt;
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;

    // The loop: last frame, zoomed and turned about the centre.
    float frames = TIMEDELTA * 60.0;
    float ang = (rotate * 0.012 + 0.002 * sin(vxPhase * 0.13)) * frames;
    float zf = exp(-zoom * 0.012 * frames);
    vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
    c = mat2(cos(ang), sin(ang), -sin(ang), cos(ang)) * c * zf;
    vec2 back = c / vec2(aspect, 1.0) + 0.5;
    float inside = step(0.0, back.x) * step(back.x, 1.0) * step(0.0, back.y) * step(back.y, 1.0);

    if (PASSINDEX == 0) {
        vec3 prev = IMG_NORM_PIXEL(trail, back).rgb * inside;
        float keep = pow(mix(0.75, 0.965, feedback), frames);
        vec3 next = synthPatch(uv, 0.0) * 0.4 + prev * keep;
        // Soft saturation, and a little off the bottom so the blacks stay black.
        next = tanh(next) - 0.004 * frames;
        if (FRAMEINDEX < 2) next = vec3(0.0);
        gl_FragColor = vec4(max(next, 0.0), 1.0);
        return;
    }

    vec3 col = synthPatch(uv, 1.0);
    vec3 echo = IMG_NORM_PIXEL(trail, back).rgb * inside;
    col = tanh(col * 1.15 + echo * feedback * 0.45);
    col += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0;
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
