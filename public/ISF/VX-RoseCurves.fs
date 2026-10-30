/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A harmonograph drawn by the chord. The sounding notes' frequency ratios swing three pendulums: two across the paper and one turning it, so a consonant chord draws a closed, symmetric figure and a dissonant one an open, drifting one. The pen traces slowly and spirals inward as the pendulums lose energy; each new chord starts a fresh drawing over the fading old one.",
    "PASSES": [
        {
            "TARGET": "rcMeta",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {
            "TARGET": "rcChord",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {
            "TARGET": "rcPenB",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {
            "TARGET": "rcPenA",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {
            "TARGET": "rcPaper",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": "$WIDTH",
            "HEIGHT": "$HEIGHT"
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 7, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "traceSpeed", "LABEL": "Trace speed", "TYPE": "float", "DEFAULT": 0.75, "MIN": 0, "MAX": 1 },
        { "NAME": "damping", "LABEL": "Damping", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "lineWidth", "LABEL": "Line width", "TYPE": "float", "DEFAULT": 0.25, "MIN": 0, "MAX": 1 },
        { "NAME": "figureSize", "LABEL": "Size", "TYPE": "float", "DEFAULT": 0.72, "MIN": 0, "MAX": 1 },
        { "NAME": "fade", "LABEL": "Fade", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "rotation", "LABEL": "Rotation", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "brightness", "LABEL": "Brightness", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "penSize", "LABEL": "Pen point", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Line", "TYPE": "color", "DEFAULT": [0.72, 0.82, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Pen", "TYPE": "color", "DEFAULT": [1.0, 0.8, 0.45, 1.0] },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxBar", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
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

// State, one value set per 1x1 target:
// rcMeta  = (last note count + 100 once running, time since the last strike, chord level, 0)
// rcChord = the locked chord, midi notes low to high (0 = empty)
// rcPenA  = pen time in pendulum cycles: (whole, 64ths, remainder, chord signature)
// rcPenB  = the pen time a frame ago, same layout, and w = drawings started (for variety)
// rcPaper = r and b: drawings, alternating, so the one being drawn fades slowly
//           and the one before it fades faster; g: fresh ink near the pen
const float TAU = 6.2831853;
const float LISTEN = 0.1;
const int STEPS = 16;

float hash21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float frameDt() {
    return clamp(TIMEDELTA, 0.0, 0.1);
}

// Root cycles per second.
float cyclesPerSec() {
    return 0.2 + 2.8 * traceSpeed * traceSpeed;
}

// Energy lost per root cycle.
float dampPerCycle() {
    return mix(0.004, 0.11, damping);
}

vec2 liveNote(int i) {
    if (i == 0) return vec2(vxNote0, vxNoteE0);
    if (i == 1) return vec2(vxNote1, vxNoteE1);
    if (i == 2) return vec2(vxNote2, vxNoteE2);
    return vec2(vxNote3, vxNoteE3);
}

float maxEnergy() {
    return max(max(vxNoteE0, vxNoteE1), max(vxNoteE2, vxNoteE3));
}

vec4 sortNotes(vec4 m) {
    float a0 = m.x > 0.5 ? m.x : 999.0;
    float a1 = m.y > 0.5 ? m.y : 999.0;
    float a2 = m.z > 0.5 ? m.z : 999.0;
    float a3 = m.w > 0.5 ? m.w : 999.0;
    float lo = min(a0, a1); float hi = max(a0, a1); a0 = lo; a1 = hi;
    lo = min(a2, a3); hi = max(a2, a3); a2 = lo; a3 = hi;
    lo = min(a0, a2); hi = max(a0, a2); a0 = lo; a2 = hi;
    lo = min(a1, a3); hi = max(a1, a3); a1 = lo; a3 = hi;
    lo = min(a1, a2); hi = max(a1, a2); a1 = lo; a2 = hi;
    vec4 s = vec4(a0, a1, a2, a3);
    return vec4(s.x > 900.0 ? 0.0 : s.x, s.y > 900.0 ? 0.0 : s.y, s.z > 900.0 ? 0.0 : s.z, s.w > 900.0 ? 0.0 : s.w);
}

float chordSig(vec4 ch) {
    return mod(ch.x + ch.y * 3.0 + ch.z * 7.0 + ch.w * 13.0, 2039.0);
}

float penTime(vec4 p) {
    return p.x + (p.y + p.z) / 64.0;
}

vec4 packTime(float t, float w) {
    float whole = floor(t);
    float f = (t - whole) * 64.0;
    float hi = floor(f);
    return vec4(whole, hi, f - hi, w);
}

// A note's frequency ratio to the root, 2^(semitones/12), folded into one octave.
float ratioTo(float m, float root) {
    float s = m - root;
    if (s > 12.5) s = mod(s, 12.0);
    if (s < 0.5) s = 12.0;
    return exp2(s / 12.0);
}

// Pendulum frequencies: x swings at the root, y at the top of the triad
// (or the interval, or the octave of a lone note), the paper turns at the
// middle note, and a fourth note adds a small extra swing to both axes.
vec4 pendulums(vec4 ch) {
    float r1 = ch.y > 0.5 ? ratioTo(ch.y, ch.x) : 2.0;
    float r2 = ch.z > 0.5 ? ratioTo(ch.z, ch.x) : 0.0;
    float r3 = ch.w > 0.5 ? ratioTo(ch.w, ch.x) : 0.0;
    if (r2 > 0.0) return vec4(1.0, r2, r1, r3);
    return vec4(1.0, r1, 1.0, 0.0);
}

float figureRadius() {
    return mix(0.22, 0.5, figureSize);
}

// Where the pen is at time t (in root cycles), in frame-height units from the centre.
vec2 harmonograph(float t, vec4 f, float d, float theta0) {
    float eL = exp(-d * t);
    float eR = exp(-d * 0.55 * t);
    float ph = TAU * t;
    vec2 p = vec2(0.58 * sin(ph * f.x + 1.5708), 0.58 * sin(ph * f.y)) * eL;
    p += 0.34 * vec2(cos(ph * f.z), sin(ph * f.z)) * eR;
    if (f.w > 0.0) p += 0.16 * vec2(sin(ph * f.w), cos(ph * f.w + 0.6)) * eL;
    float th = theta0 + (rotation * rotation) * 0.09 * t;
    float c = cos(th);
    float s = sin(th);
    return vec2(c * p.x - s * p.y, s * p.x + c * p.y) * figureRadius();
}

float startAngle(vec4 ch, float drawings) {
    // Roots walk the circle of fifths so neighbouring chords sit apart.
    float pc = mod(mod(ch.x, 12.0) * 7.0, 12.0);
    return pc * 0.2618 + drawings * 2.39996;
}

// Does the pen start a fresh drawing this frame?
bool restartNow(vec4 penLast, vec4 meta, vec4 ch) {
    if (FRAMEINDEX < 2) return true;
    float since = meta.y;
    if (since < LISTEN) return false;
    float amp = exp(-dampPerCycle() * penTime(penLast));
    if (abs(chordSig(ch) - penLast.w) > 0.5) return true;
    // The same chord struck again re-swings a tired pendulum.
    if (since - frameDt() < LISTEN && amp < 0.6) return true;
    // A long-held chord, or rest, begins again on a bar line once it has run down.
    if (amp < 0.08 || (amp < 0.3 && vxBar < 0.04)) return true;
    return false;
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    vec2 c = vec2(0.5);
    float dt = frameDt();

    if (PASSINDEX == 0) {
        vec4 me = IMG_NORM_PIXEL(rcMeta, c);
        bool ready = FRAMEINDEX >= 2 && me.x > 99.5;
        float count = floor(vxCount + 0.5);
        bool strike = ready && abs(count - (me.x - 100.0)) > 0.5;
        // On start, listen at once so a chord already sounding is heard.
        float since = (!ready) ? 0.0 : (strike ? 0.0 : min(me.y + dt, 100.0));
        float target = maxEnergy();
        float lvl = ready ? me.z : 0.0;
        lvl += (target - lvl) * (1.0 - exp(-dt / (target > lvl ? 0.06 : 1.4)));
        gl_FragColor = vec4(count + 100.0, since, lvl, 0.0);
        return;
    }

    vec4 meta = IMG_NORM_PIXEL(rcMeta, c);

    if (PASSINDEX == 1) {
        vec4 ch = IMG_NORM_PIXEL(rcChord, c);
        float maxE = maxEnergy();
        if (FRAMEINDEX < 2 || ch.x < 0.5) {
            // Rest: a fifth.
            ch = vec4(57.0, 64.0, 0.0, 0.0);
        }
        if (meta.y < LISTEN && maxE > 0.01) {
            // Listening just after a strike: the chord is every note sounding near the loudest.
            vec4 m = vec4(0.0);
            for (int i = 0; i < 4; i++) {
                vec2 ln = liveNote(i);
                float midi = floor(ln.x * 127.0 + 0.5);
                float keep = (ln.x > 0.0 && ln.y >= 0.45 * maxE) ? midi : 0.0;
                if (i == 0) m.x = keep;
                if (i == 1) m.y = keep;
                if (i == 2) m.z = keep;
                if (i == 3) m.w = keep;
            }
            // Drop doubled notes.
            if (abs(m.y - m.x) < 0.5) m.y = 0.0;
            if (abs(m.z - m.x) < 0.5 || abs(m.z - m.y) < 0.5) m.z = 0.0;
            if (abs(m.w - m.x) < 0.5 || abs(m.w - m.y) < 0.5 || abs(m.w - m.z) < 0.5) m.w = 0.0;
            vec4 s = sortNotes(m);
            if (s.x > 0.5) ch = s;
        }
        gl_FragColor = ch;
        return;
    }

    vec4 ch = IMG_NORM_PIXEL(rcChord, c);

    if (PASSINDEX == 2) {
        // The pen a frame ago, and the count of drawings so far.
        vec4 penLast = IMG_NORM_PIXEL(rcPenA, c);
        vec4 me = IMG_NORM_PIXEL(rcPenB, c);
        float drawings = FRAMEINDEX < 2 ? 0.0 : me.w;
        if (restartNow(penLast, meta, ch)) drawings = mod(drawings + 1.0, 16.0);
        gl_FragColor = vec4(penLast.xyz, drawings);
        return;
    }

    if (PASSINDEX == 3) {
        vec4 penLast = IMG_NORM_PIXEL(rcPenA, c);
        float t = penTime(penLast);
        if (restartNow(penLast, meta, ch)) {
            gl_FragColor = packTime(0.0, chordSig(ch));
            return;
        }
        if (meta.y >= LISTEN) t += dt * cyclesPerSec();
        gl_FragColor = packTime(t, penLast.w);
        return;
    }

    vec4 penA = IMG_NORM_PIXEL(rcPenA, c);
    vec4 penB = IMG_NORM_PIXEL(rcPenB, c);
    float t1 = penTime(penA);
    float t0 = penTime(penB);
    vec4 f = pendulums(ch);
    float d = dampPerCycle();
    float theta0 = startAngle(ch, penB.w);
    // The pen's ink: the chord's level, never quite dry at rest.
    float level = max(meta.z, 0.0);
    float inkLevel = 0.22 + 0.78 * smoothstep(0.0, 0.6, level);

    if (PASSINDEX == 4) {
        vec4 prev = IMG_NORM_PIXEL(rcPaper, uv);
        float hold = mix(1.2, 14.0, fade * fade);
        float slowKeep = exp(-dt / hold);
        float oldKeep = exp(-dt / (hold * 0.3));
        bool onR = mod(penB.w, 2.0) < 0.5;
        float floorCut = 0.0003 * dt * 60.0;
        float r = max(prev.r * (onR ? slowKeep : oldKeep) - floorCut, 0.0);
        float bb = max(prev.b * (onR ? oldKeep : slowKeep) - floorCut, 0.0);
        float g = max(prev.g * exp(-dt / 0.45) - 0.002 * dt * 60.0, 0.0);
        if (FRAMEINDEX < 2) {
            r = 0.0;
            bb = 0.0;
            g = 0.0;
        }
        float span = t1 - t0;
        if (meta.y >= LISTEN && span > 0.0 && span < 1.0) {
            vec2 q = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
            float pxH = 1.0 / RENDERSIZE.y;
            // The pen never travels farther than this in one frame.
            float reach = TAU * (0.58 * (f.x + f.y) + 0.34 * f.z + 0.32 * f.w) * figureRadius() * span;
            vec2 pm = harmonograph(t0 + 0.5 * span, f, d, theta0);
            vec2 fw = max(fwidth(gl_FragCoord.xy), vec2(1.0));
            // Never thinner than a stored pixel, or the line breaks into dots as it fades.
            float sigma = max(mix(0.45, 1.6, lineWidth), 0.8 * fw.x);
            float norm = mix(0.45, 1.6, lineWidth) / sigma;
            if (length(q - pm) < 0.5 * reach + 4.0 * sigma * pxH) {
                vec2 a = harmonograph(t0, f, d, theta0);
                float best = 1e9;
                float segLen = 0.0;
                for (int k = 1; k <= STEPS; k++) {
                    vec2 b = harmonograph(t0 + span * float(k) / float(STEPS), f, d, theta0);
                    vec2 ab = b - a;
                    float h = clamp(dot(q - a, ab) / max(dot(ab, ab), 1e-12), 0.0, 1.0);
                    vec2 dv = q - a - ab * h;
                    float dd = dot(dv, dv);
                    if (dd < best) {
                        best = dd;
                        segLen = length(ab);
                    }
                    a = b;
                }
                float dpx = sqrt(best) / pxH;
                float line = exp(-0.5 * dpx * dpx / (sigma * sigma)) * norm;
                // The pen lingers at the turns, so they take more ink.
                float slow = 1.0 / (1.0 + 0.06 * segLen / pxH);
                float ink1 = line * inkLevel * (0.7 + 0.3 * slow);
                if (onR) r = max(r, ink1);
                else bb = max(bb, ink1);
                g = max(g, line);
            }
        }
        gl_FragColor = vec4(r, g, bb, 1.0);
        return;
    }

    vec4 paper = IMG_NORM_PIXEL(rcPaper, uv);
    float gain = 0.5 + 1.6 * brightness;
    vec3 col = ink.rgb * (1.0 - exp(-(paper.r + paper.b) * gain * 1.4));
    col += ink.rgb * paper.g * 0.18 * gain * inkLevel;

    // The pen point.
    if (meta.y >= LISTEN) {
        vec2 q = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
        vec2 p = harmonograph(t1, f, d, theta0);
        vec2 fw = max(fwidth(gl_FragCoord.xy), vec2(1.0));
        float dpx = length(q - p) * RENDERSIZE.y;
        float rad = max(mix(0.0012, 0.006, penSize) * RENDERSIZE.y, 0.9 * fw.x);
        float core = 1.0 - smoothstep(rad - 0.7 * fw.x, rad + 0.7 * fw.x, dpx);
        float halo = exp(-dpx / (rad * 2.5)) * 0.18;
        float lit = 0.35 + 0.65 * inkLevel;
        col = mix(col, accent.rgb * lit, core);
        col += accent.rgb * halo * lit;
    }

    col += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0;
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
