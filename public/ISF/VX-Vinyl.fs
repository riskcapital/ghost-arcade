/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A dubplate turning at 33 under a cutting stylus, seen at an angle. Fine spiral grooves catch a slow band of sheen; the sound it follows is cut into the groove at the stylus as a wiggle at its own pitch, which turns away with the record and fades.",
    "PASSES": [
        {
            "TARGET": "notes",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 24,
            "HEIGHT": 24
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 5, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "rotation", "LABEL": "Rotation", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 2 },
        { "NAME": "grooves", "LABEL": "Groove density", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "sheen", "LABEL": "Sheen", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "modulation", "LABEL": "Modulation", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "memory", "LABEL": "Cut memory", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "tilt", "LABEL": "Tilt", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "labelSize", "LABEL": "Label size", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "lineWidth", "LABEL": "Line width", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Grooves", "TYPE": "color", "DEFAULT": [1.0, 0.72, 0.36, 1.0] },
        { "NAME": "accent", "LABEL": "Label ring", "TYPE": "color", "DEFAULT": [0.25, 0.9, 0.62, 1.0] },
        { "NAME": "vxEnv", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxVel", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPitch", "TYPE": "float", "DEFAULT": 0.28, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// notes: a 3 x 3 grid of cells, 8 x 8 texels each, read at their centres. Cells 0..7
// hold the newest notes as (whole seconds of age, fraction of a second, MIDI note / 127,
// velocity); cell 8 holds (turns of the record, mod 1; last count + 1; 0; 0).
const float CELLS = 3.0;
const float TAU = 6.2831853;
const float R_OUT = 0.97;
const float R_IN = 0.43;
const float NEEDLE_A = 0.42;   // where the stylus sits, radians
const float NEEDLE_R = 0.8;

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

vec4 cellAt(float i) {
    return IMG_NORM_PIXEL(notes, vec2((mod(i, CELLS) + 0.5) / CELLS, (floor(i / CELLS) + 0.5) / CELLS));
}

float revPerSec() {
    return 33.333 / 60.0 * rotation;
}

// Iso-line of q at every integer; w = radius in rendered pixels. Crowded lines fade.
// fwc is the plain line density used for the crowding fade; a wiggle cut into the
// line widens fwq but must not fade it.
float isoLine(float q, float fwq, float fwc, float w) {
    float fw = max(fwq, 1e-6);
    float d = abs(fract(q + 0.5) - 0.5) / fw;
    return exp(-d * d / (w * w)) * (1.0 - smoothstep(0.22, 0.45, fwc));
}

float ringLine(float r, float r0, float w) {
    float fw = clamp(fwidth(r), 1e-6, 0.02);
    float d = (r - r0) / fw;
    return exp(-d * d / (w * w));
}

vec2 project(vec3 P, vec3 C, vec3 fwd, vec3 right, vec3 up, float F) {
    vec3 v = P - C;
    return vec2(dot(v, right), dot(v, up)) / dot(v, fwd) * F;
}

float segDist(vec2 p, vec2 a, vec2 b) {
    vec2 ab = b - a;
    vec2 ap = p - a;
    float h = clamp(dot(ap, ab) / max(dot(ab, ab), 1e-10), 0.0, 1.0);
    return length(ap - ab * h);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float dt = clamp(TIMEDELTA, 0.0, 0.1);

    if (PASSINDEX == 0) {
        float ci = floor(uv.x * CELLS) + CELLS * floor(uv.y * CELLS);
        vec4 meta = cellAt(8.0);
        float n = floor(vxCount + 0.5);
        bool ready = meta.y > 0.5 && FRAMEINDEX >= 2;
        bool fresh = ready && abs(meta.y - (n + 1.0)) > 0.5;
        if (ci < 7.5) {
            vec4 s = cellAt(ci);
            if (!ready) {
                s = vec4(0.0);
            } else {
                s.y += dt;
                if (s.y >= 1.0) {
                    s.y -= 1.0;
                    s.x = min(s.x + 1.0, 60.0);
                }
            }
            if (fresh && abs(ci - mod(n, 8.0)) < 0.5) s = vec4(0.0, 0.0, vxPitch, clamp(vxVel, 0.2, 1.0));
            gl_FragColor = s;
        } else {
            float turns = ready ? fract(meta.x + dt * revPerSec()) : 0.0;
            gl_FragColor = vec4(turns, n + 1.0, 0.0, 0.0);
        }
        return;
    }

    vec2 p = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
    vec2 fwp = fwidth(gl_FragCoord.xy);
    float pxs = max(1.0, max(fwp.x, fwp.y));
    float px = pxs / RENDERSIZE.y;
    vec4 meta = cellAt(8.0);
    float rot = meta.x * TAU;
    float rps = max(revPerSec(), 0.02);

    // Camera above the front edge of the deck, looking down at the record.
    float tl = mix(0.35, 1.2, tilt);
    float dist = 3.3;
    vec3 C = dist * vec3(0.0, -sin(tl), cos(tl));
    vec3 target = vec3(0.1, -0.1, 0.0);
    vec3 fwd = normalize(target - C);
    vec3 right = normalize(cross(fwd, vec3(0.0, 0.0, 1.0)));
    vec3 up = cross(right, fwd);
    float F = 1.72;
    vec3 rd = normalize(right * p.x + up * p.y + fwd * F);
    float tp = -C.z / rd.z;
    vec2 D = (C + rd * tp).xy;
    float r = length(D);
    float th = atan(D.y, D.x);
    float thd = th - rot;
    // The same angle with its seam on the other side: its derivative has no jump where atan wraps.
    float th2 = atan(-D.y, -D.x);
    float fwTh = min(fwidth(th), fwidth(th2)) / TAU;
    float fwR = fwidth(r);
    float w = mix(0.55, 1.5, lineWidth);

    vec3 col = vec3(0.0);
    float onDisc = 1.0 - smoothstep(R_OUT + 0.02, R_OUT + 0.03, r);

    // The groove: one long spiral running inward.
    // Groove spacing is set in rendered pixels, so the lines stay crisp at any size.
    float count = clamp(floor(mix(0.1, 0.26, grooves) * (R_OUT - R_IN) * F / dist / px), 16.0, 180.0);
    float pitchG = (R_OUT - R_IN) / count;
    float q = (R_OUT - r) / pitchG + thd / TAU;

    // What the stylus has cut: how long ago the groove under this pixel passed it.
    float dA = mod(th - NEEDLE_A, TAU);
    float wRev = floor((NEEDLE_R - r) / pitchG * -1.0 - dA / TAU + 0.5);
    float tau = (dA / TAU + max(wRev, 0.0)) / rps;
    float fade = mix(0.5, 3.0, memory);
    float cut = 0.0;
    float cutAmp = 0.0;
    if (wRev >= 0.0 && tau < fade * 1.6) {
        for (int i = 0; i < 8; i++) {
            vec4 s = cellAt(float(i));
            if (s.w > 0.0) {
                float a = s.x + s.y - tau;
                if (a >= 0.0 && a < 0.6) {
                    // The note's own frequency, two octaves down so the wiggle reads.
                    float midi = s.z * 127.0;
                    float hz = 440.0 * exp2((midi - 69.0) / 12.0) * 0.25;
                    float ph = TAU * hz * a;
                    float env = s.w * exp(-a / 0.32) * smoothstep(0.0, 0.006, a);
                    float wave = sin(ph) + 0.35 * sin(2.0 * ph + 0.6) + 0.12 * sin(3.0 * ph + 1.1);
                    float k = env * exp(-tau / fade);
                    if (k > cutAmp) {
                        cutAmp = k;
                        cut = wave * k;
                    }
                }
            }
        }
    }
    float qm = q + cut * modulation * 0.75;
    float fwPlain = fwR / pitchG + fwTh;
    float groove = isoLine(qm, fwPlain + abs(fwidth(cut)) * modulation * 0.75, fwPlain, w * 0.85);

    // Sheen: grooves catch the light where they run across it, a band through the centre.
    float lightA = 2.2 + vxPhase * 0.05;
    float da = abs(mod(th - lightA + TAU * 0.25, TAU * 0.5) - TAU * 0.25);
    float bw = mix(0.08, 0.32, sheen);
    float band = exp(-da * da / (bw * bw));
    float playing = smoothstep(R_IN, R_IN + 0.01, r) * (1.0 - smoothstep(R_OUT - 0.005, R_OUT, r));
    float glint = 0.14 + 1.2 * band * mix(0.3, 1.0, sheen) + 1.4 * cutAmp * modulation;
    col += ink.rgb * groove * glint * playing;

    // Outer edge and lead-in.
    col += ink.rgb * ringLine(r, R_OUT + 0.012, w) * 0.55;
    col += ink.rgb * ringLine(r, R_OUT - 0.004, w * 0.8) * 0.25;

    // Dead wax: the run-out loops and a few etched marks that turn with the record.
    float rl = mix(0.2, 0.36, labelSize);
    float wax = smoothstep(rl + 0.015, rl + 0.03, r) * (1.0 - smoothstep(R_IN - 0.02, R_IN, r));
    float fwRun = fwR / ((R_IN - rl) / 3.2) + fwTh;
    float runout = isoLine((R_IN - r) / ((R_IN - rl) / 3.2) + thd / TAU, fwRun, fwRun, w * 0.8) * wax * 0.35;
    col += ink.rgb * runout * (0.4 + 0.6 * band);
    float etchA = mod(thd, TAU);
    float etch = 0.0;
    for (int i = 0; i < 4; i++) {
        float fi = float(i);
        float a0 = hash11(fi * 3.3 + 1.0) * TAU;
        float rr = mix(rl + 0.04, R_IN - 0.03, hash11(fi * 5.1 + 2.0));
        float len = 0.15 + 0.35 * hash11(fi * 7.7);
        float inArc = step(0.0, mod(etchA - a0, TAU)) * step(mod(etchA - a0, TAU), len);
        etch = max(etch, ringLine(r, rr, w * 0.7) * inArc);
    }
    col += ink.rgb * etch * 0.45;

    // Label: its rim in the accent, a printed ring, the spindle, and a hand-written mark.
    col += accent.rgb * ringLine(r, rl, w * 1.1) * (0.55 + 0.35 * vxEnv);
    col += ink.rgb * ringLine(r, rl * 0.8, w * 0.7) * 0.22;
    col += ink.rgb * ringLine(r, 0.022, w * 0.8) * 0.5;
    float scrA = mod(thd - 1.1, TAU);
    float scrR = rl * (0.48 + 0.08 * sin(scrA * 9.0) * step(scrA, 2.4));
    col += ink.rgb * ringLine(r, scrR, w * 0.75) * step(scrA, 2.4) * 0.4;
    float dash = ringLine(r, rl * 0.6, w * 0.7) * step(mod(thd + 2.6, TAU), 0.9) * 0.4;
    col += ink.rgb * dash;
    col *= onDisc;

    // The tonearm: pivot off the record, a straight arm and a headshell over the stylus.
    vec2 needle = NEEDLE_R * vec2(cos(NEEDLE_A), sin(NEEDLE_A));
    vec2 pivot = vec2(1.24, 0.98);
    vec2 dirArm = normalize(needle - pivot);
    vec2 nrm = vec2(-dirArm.y, dirArm.x);
    float zA = 0.07;
    vec2 sPivot = project(vec3(pivot, zA), C, fwd, right, up, F);
    vec2 sElbow = project(vec3(needle - dirArm * 0.24, zA), C, fwd, right, up, F);
    vec2 h1 = needle - dirArm * 0.13 + nrm * 0.03;
    vec2 h2 = needle + dirArm * 0.05 + nrm * 0.03;
    vec2 h3 = needle + dirArm * 0.05 - nrm * 0.03;
    vec2 h4 = needle - dirArm * 0.13 - nrm * 0.03;
    vec2 s1 = project(vec3(h1, zA), C, fwd, right, up, F);
    vec2 s2 = project(vec3(h2, zA), C, fwd, right, up, F);
    vec2 s3 = project(vec3(h3, zA), C, fwd, right, up, F);
    vec2 s4 = project(vec3(h4, zA), C, fwd, right, up, F);
    vec2 sTip = project(vec3(needle, 0.0), C, fwd, right, up, F);
    vec2 sTop = project(vec3(needle, zA), C, fwd, right, up, F);
    float dArm = segDist(p, sPivot, sElbow);
    dArm = min(dArm, segDist(p, sElbow, 0.5 * (s1 + s4)));
    float dHead = min(min(segDist(p, s1, s2), segDist(p, s2, s3)), min(segDist(p, s3, s4), segDist(p, s4, s1)));
    float dTip = segDist(p, sTop, sTip);
    float arm = exp(-pow(dArm / px / w, 2.0)) * 0.6;
    arm = max(arm, exp(-pow(dHead / px / w, 2.0)) * 0.7);
    arm = max(arm, exp(-pow(dTip / px / w, 2.0)) * 0.9);
    // Pivot: two rings on its post.
    vec3 Q = C + rd * ((zA - C.z) / rd.z);
    float pr = length(Q.xy - pivot);
    arm = max(arm, ringLine(pr, 0.075, w) * 0.5);
    arm = max(arm, ringLine(pr, 0.03, w) * 0.4);
    col = col * (1.0 - min(arm, 1.0)) + ink.rgb * arm;
    // A hot point where the stylus meets the groove while it cuts.
    float dn = length(p - sTip) / px;
    col += ink.rgb * exp(-dn * dn / 3.0) * (0.25 + 0.9 * vxEnv);

    col += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0;
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
