/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A clear glass prism hanging over a dark floor, slowly rocking, with beams of light crossing the haze to strike it. Each note of the chord is one beam: the note's place in the octave sets the angle it comes in at, so harmony changes where the light lands. Inside the glass every beam bends and splits, and leaves as a fan of spectrum colors that falls across the floor; louder notes burn brighter. With no sound the beams rest dim and the prism turns on its own.",
    "PASSES": [
        {
            "TARGET": "beams",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 32,
            "HEIGHT": 1
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 7, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "dispersion", "LABEL": "Dispersion", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "haze", "LABEL": "Haze", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "rock", "LABEL": "Rocking", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "depth", "LABEL": "Glass color", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "First beams", "TYPE": "color", "DEFAULT": [1.0, 0.84, 0.66, 1.0] },
        { "NAME": "accent", "LABEL": "Second beams", "TYPE": "color", "DEFAULT": [0.7, 0.82, 1.0, 1.0] },
        { "NAME": "palLight", "LABEL": "Glass", "TYPE": "color", "DEFAULT": [0.62, 0.92, 1.0, 1.0] },
        { "NAME": "palGround", "LABEL": "Room", "TYPE": "color", "DEFAULT": [0.32, 0.24, 0.5, 1.0] },
        { "NAME": "vxEnv", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxGlide", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
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

const float PI = 3.14159265;
// How dim a beam with no note rests.
const float REST = 0.2;
// Wavelength samples across the spectrum (red to violet).
const int NL = 7;
// Width of the chamfer on each edge.
const float BEVEL = 0.011;

float hash21(vec2 q) {
    vec3 p3 = fract(vec3(q.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

// The prism, set once per pixel in main: center, the three side normals, the long axis,
// inradius of the triangle and half its length.
vec3 gC;
vec3 gN0;
vec3 gN1;
vec3 gN2;
vec3 gAx;
float gRin;
float gHalf;

// Planes 0-2 are the sides, 3-4 the ends, and 5-13 narrow chamfers on the nine edges, which
// catch the studio lights as thin glints the way a real polished prism's edges do.
vec3 planeN(float i) {
    if (i < 0.5) return gN0;
    if (i < 1.5) return gN1;
    if (i < 2.5) return gN2;
    if (i < 3.5) return gAx;
    if (i < 4.5) return -gAx;
    if (i < 5.5) return -gN2;
    if (i < 6.5) return -gN0;
    if (i < 7.5) return -gN1;
    if (i < 8.5) return normalize(gN0 + gAx);
    if (i < 9.5) return normalize(gN1 + gAx);
    if (i < 10.5) return normalize(gN2 + gAx);
    if (i < 11.5) return normalize(gN0 - gAx);
    if (i < 12.5) return normalize(gN1 - gAx);
    return normalize(gN2 - gAx);
}

float planeH(float i) {
    if (i < 2.5) return gRin;
    if (i < 4.5) return gHalf;
    if (i < 7.5) return 2.0 * gRin - BEVEL * 2.0;
    return (gRin + gHalf) * 0.70710678 - BEVEL;
}

// Ray against the prism from outside: (t in, t out, plane in, plane out).
vec4 prismHit(vec3 ro, vec3 rd, float nPl) {
    float tN = -1e9;
    float tF = 1e9;
    float iN = 0.0;
    float iF = 0.0;
    for (int k = 0; k < 14; k++) {
        float fi = float(k);
        if (fi > nPl - 0.5) break;
        vec3 n = planeN(fi);
        float s = dot(n, ro - gC) - planeH(fi);
        float den = dot(n, rd);
        if (abs(den) < 1e-6) {
            if (s > 0.0) tN = 1e9;
        } else {
            float t = -s / den;
            if (den < 0.0) {
                if (t > tN) { tN = t; iN = fi; }
            } else {
                if (t < tF) { tF = t; iF = fi; }
            }
        }
    }
    return vec4(tN, tF, iN, iF);
}

// From inside the prism, where the ray leaves: (t, plane).
vec2 prismExit(vec3 ro, vec3 rd) {
    float tF = 1e9;
    float iF = 0.0;
    for (int k = 0; k < 5; k++) {
        float fi = float(k);
        vec3 n = planeN(fi);
        float den = dot(n, rd);
        if (den > 1e-6) {
            float t = (planeH(fi) - dot(n, ro - gC)) / den;
            if (t < tF) { tF = t; iF = fi; }
        }
    }
    return vec2(tF, iF);
}

// Follow light inside the glass from p along d until it gets out (allowing two internal
// reflections). Columns: exit point, exit direction, (got out, length inside, 0).
mat3 throughGlass(vec3 p, vec3 d, float ior) {
    float len = 0.0;
    for (int b = 0; b < 3; b++) {
        vec2 ex = prismExit(p, d);
        vec3 q = p + d * ex.x;
        len += ex.x;
        vec3 n = planeN(ex.y);
        vec3 o = refract(d, -n, ior);
        if (dot(o, o) > 0.5) return mat3(q, o, vec3(1.0, len, 0.0));
        d = reflect(d, -n);
        p = q;
    }
    return mat3(p, d, vec3(0.0, len, 0.0));
}

// Index of refraction for a point on the spectrum (0 red to 1 violet).
float iorAt(float x, float disp) {
    return 1.47 + x * (0.025 + 0.12 * disp);
}

// A smooth spectrum: red, through green, to violet with a touch of red in it.
vec3 spectrum(float x) {
    float r = exp(-pow((x - 0.05) / 0.24, 2.0)) + 0.35 * exp(-pow((x - 1.0) / 0.14, 2.0));
    float g = exp(-pow((x - 0.47) / 0.22, 2.0));
    float b = exp(-pow((x - 0.86) / 0.2, 2.0));
    return vec3(r, g, b);
}

// A soft-edged panel of light around direction c: half sizes hw (sideways) and hh (up).
float panel(vec3 d, vec3 c, float hw, float hh) {
    float a = dot(d, c);
    if (a <= 0.0) return 0.0;
    vec3 u = normalize(cross(vec3(0.0, 1.0, 0.0), c));
    vec3 v = cross(c, u);
    vec2 q = vec2(dot(d, u), dot(d, v)) / a;
    vec2 e = abs(q) - vec2(hw, hh);
    float soft = 0.035;
    // Brighter in the middle, as a real soft box is.
    vec2 qn = q / vec2(hw, hh);
    float grad = clamp(1.0 - 0.55 * qn.y * qn.y - 0.3 * qn.x * qn.x, 0.15, 1.0);
    return smoothstep(soft, -soft, e.x) * smoothstep(soft, -soft, e.y) * grad;
}

// The dark studio the glass reflects and shows through itself: a dim colored horizon, two
// tall strip lights behind the prism (they light its edges from behind, as in a glass
// photograph), a soft box overhead and a faint wash behind.
vec3 studio(vec3 d) {
    vec3 col = vec3(0.0);
    float up = smoothstep(-0.03, 0.03, d.y);
    col += palGround.rgb * (0.03 + 0.25 * exp(-max(d.y, 0.0) * 5.0)) * up;
    col += palGround.rgb * 0.012 * (1.0 - up);
    vec3 warm = vec3(1.0, 0.96, 0.9);
    // A dim wash over the upper studio so glass faces carry a faint gradient.
    col += mix(palGround.rgb, warm, 0.35) * 0.07 * smoothstep(-0.25, 0.7, d.y);
    col += warm * panel(d, normalize(vec3(-0.5, -0.15, -1.0)), 0.06, 0.7) * 3.2;
    col += mix(warm, palLight.rgb, 0.5) * panel(d, normalize(vec3(0.55, -0.12, -1.0)), 0.05, 0.65) * 2.6;
    col += warm * panel(d, normalize(vec3(-0.35, 1.0, -0.3)), 0.32, 0.14) * 2.0;
        return col;
}

// Light scattered by haze along a beam segment a to b of half-width w, seen along a camera ray.
float beamGlow(vec3 ro, vec3 rd, vec3 a, vec3 b, float w0, float grow, float tMax) {
    vec3 ab = b - a;
    float L = length(ab);
    if (L < 1e-4) return 0.0;
    vec3 u = ab / L;
    vec3 oa = ro - a;
    float bb = dot(rd, u);
    float d = dot(rd, oa);
    float e = dot(u, oa);
    float den = max(1.0 - bb * bb, 1e-4);
    float tc = (bb * e - d) / den;
    float sc = clamp((e - bb * d) / den, 0.0, L);
    tc = max(dot(a + u * sc - ro, rd), 0.0);
    vec3 diff = ro + rd * tc - (a + u * sc);
    // The beam widens as it travels.
    float w = w0 + grow * sc;
    float dist2 = dot(diff, diff);
    // Thicker beams look dimmer per unit, as the same light spreads out; behind a solid it is hidden.
    float vis = tc < tMax ? 1.0 : 0.0;
    // A beam seen end on piles up more haze; keep it bounded.
    float pile = 1.0 / sqrt(den + 0.04);
    return exp(-dist2 / (w * w)) * vis * min(pile, 3.0) * (0.035 / w);
}

float noteAt(float i) {
    if (i < 0.5) return vxNote0;
    if (i < 1.5) return vxNote1;
    if (i < 2.5) return vxNote2;
    return vxNote3;
}

float energyAt(float i) {
    if (i < 0.5) return vxNoteE0;
    if (i < 1.5) return vxNoteE1;
    if (i < 2.5) return vxNoteE2;
    return vxNoteE3;
}

void main() {
    if (PASSINDEX == 0) {
        // One slot (eight texels wide) per beam: its angle (0-1) and brightness, both eased so
        // a chord change swings the beams over to their new angles instead of cutting.
        float i = clamp(floor(gl_FragCoord.x / 8.0), 0.0, 3.0);
        vec4 prev = IMG_NORM_PIXEL(beams, vec2((i + 0.5) / 4.0, 0.5));
        float anyNote = max(max(vxNoteE0, vxNoteE1), max(vxNoteE2, vxNoteE3));
        float e = energyAt(i);
        float restAim = 0.3 + i * 0.13;
        float aim = e > 0.02 ? fract(noteAt(i) * 127.0 / 12.0) : (anyNote > 0.02 ? prev.x : restAim);
        float bright = anyNote > 0.02 ? max(e, REST * 0.5) : REST + 0.7 * clamp(vxEnv, 0.0, 1.0);
        float dt = clamp(TIMEDELTA, 0.0, 0.1);
        float a = mix(prev.x, aim, 1.0 - exp(-dt / 0.28));
        float b = prev.y + (bright - prev.y) * (1.0 - exp(-dt / (bright > prev.y ? 0.05 : 0.6)));
        if (FRAMEINDEX < 2 || prev.a < 0.5) {
            a = aim;
            b = bright;
        }
        gl_FragColor = vec4(a, b, 0.0, 1.0);
        return;
    }

    vec2 p = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;

    // The prism: a triangle of side 1.25 along a long axis, rocking slowly about that axis and
    // turning a little on the vertical so its end face shows. The latest note tilts it.
    float tilt = vxGlide > 0.01 ? (vxGlide - 0.5) * 0.5 : 0.0;
    float rk = clamp(rock, 0.0, 1.0);
    float roll = (0.08 + 0.2 * rk) * sin(TIME * 0.21 + vxFlow * 0.05) + tilt;
    float yaw = 0.3 + (0.03 + 0.12 * rk) * sin(TIME * 0.13 + 1.0);
    gC = vec3(0.0, 1.05 + 0.03 * sin(TIME * 0.4), 0.0);
    gRin = 1.25 / (2.0 * sqrt(3.0));
    gHalf = 0.8;
    float cy = cos(yaw);
    float sy = sin(yaw);
    gAx = vec3(sy, 0.0, cy);
    vec3 side = vec3(cy, 0.0, -sy);
    vec3 upv = vec3(0.0, 1.0, 0.0);
    // Side normals of an apex-up triangle (pointing down, up-right, up-left), rolled.
    float a0 = -0.5 * PI + roll;
    float a1 = PI / 6.0 + roll;
    float a2 = 5.0 * PI / 6.0 + roll;
    gN0 = side * cos(a0) + upv * sin(a0);
    gN1 = side * cos(a1) + upv * sin(a1);
    gN2 = side * cos(a2) + upv * sin(a2);

    // Camera: a little above, the prism left of center so the fans have room to fall.
    vec3 ro = vec3(0.35, 1.85, 5.0);
    vec3 ta = vec3(0.95, 0.72, 0.0);
    vec3 fw = normalize(ta - ro);
    vec3 rt = normalize(cross(fw, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(rt, fw);
    vec3 rd = normalize(fw * 1.9 + rt * p.x + up * p.y);

    // What the camera ray meets: glass, then floor.
    // Glass coverage from four sub-pixel rays, so its silhouette is anti-aliased; the glass is
    // shaded along the center ray, or along a covered sub-ray at the very edge.
    vec4 gh = prismHit(ro, rd, 14.0);
    float onGlass = (gh.x < gh.y && gh.x > 0.0) ? 1.0 : 0.0;
    vec3 rdG = rd;
    vec4 ghG = gh;
    float cov = 0.0;
    for (int sI = 0; sI < 4; sI++) {
        float fs = float(sI);
        // A rotated grid: (-1,-3), (3,-1), (1,3), (-3,1) eighths of a pixel.
        vec2 off = vec2(-0.125, -0.375);
        if (fs > 0.5) off = vec2(0.375, -0.125);
        if (fs > 1.5) off = vec2(0.125, 0.375);
        if (fs > 2.5) off = vec2(-0.375, 0.125);
        off /= RENDERSIZE.y;
        vec3 rds = normalize(fw * 1.9 + rt * (p.x + off.x) + up * (p.y + off.y));
        vec4 hs = prismHit(ro, rds, 14.0);
        if (hs.x < hs.y && hs.x > 0.0) {
            cov += 0.25;
            if (onGlass < 0.5) { rdG = rds; ghG = hs; onGlass = 0.5; }
        }
    }
    onGlass = cov > 0.0 ? 1.0 : 0.0;
    float tGround = rd.y < 0.0 ? -ro.y / rd.y : 1e9;
    vec3 gp = ro + rd * tGround;

    float hz = 0.25 + 1.1 * clamp(haze, 0.0, 1.0);
    float disp = clamp(dispersion, 0.0, 1.0);
    vec3 air = vec3(0.0);
    vec3 floorLight = vec3(0.0);
    vec3 glassGlow = vec3(0.0);
    // Spectrum normalization so the full fan sums back to the beam's own color.
    vec3 specSum = vec3(0.0);
    for (int k = 0; k < NL; k++) specSum += spectrum(float(k) / float(NL - 1));

    for (int bi = 0; bi < 4; bi++) {
        float fb = float(bi);
        vec4 st = IMG_NORM_PIXEL(beams, vec2((fb + 0.5) / 4.0, 0.5));
        float e = st.y * (1.0 + 0.35 * clamp(vxPulse, 0.0, 1.0));
        vec3 tintc = bi == 0 || bi == 2 ? ink.rgb : accent.rgb;
        vec3 bc = mix(vec3(1.0), tintc / max(max(tintc.r, tintc.g), max(tintc.b, 1e-3)), 0.5) * e;
        // The beam comes from the upper left, each at its own depth along the prism; its note
        // sets how steeply it falls, aimed at the prism's middle.
        float zb = (fb - 1.5) * 0.36;
        float elev = mix(-0.47, -0.29, st.x);
        vec3 dir = normalize(side * cos(elev) - upv * sin(elev));
        vec3 aimP = gC + gN2 * (gRin * 0.92) + gN0 * 0.13 + gAx * zb;
        vec3 src = aimP - dir * 7.0;
        vec4 bh = prismHit(src, dir, 5.0);
        float through = (bh.x < bh.y && bh.x > 0.0) ? 1.0 : 0.0;
        vec3 entry = src + dir * (through > 0.5 ? bh.x : 7.0);
        float tStop = onGlass > 0.5 ? 1e9 : tGround;
        // The incoming white beam in the haze.
        air += bc * beamGlow(ro, rd, src, entry, 0.03, 0.0, tStop) * hz;
        if (through < 0.5) {
            // Missed the glass: it carries on to the floor.
            float tg = -entry.y / min(dir.y, -0.05);
            vec3 land = entry + dir * tg;
            air += bc * beamGlow(ro, rd, entry, land, 0.03, 0.0, tStop) * hz;
            vec2 q = gp.xz - land.xz;
            floorLight += bc * exp(-dot(q, q) / 0.012) * 0.6;
            continue;
        }
        vec3 nIn = planeN(bh.z);
        // A small bright scatter where the beam strikes the glass.
        vec3 dEntry = ro + rd * max(dot(entry - ro, rd), 0.0) - entry;
        glassGlow += bc * exp(-dot(dEntry, dEntry) / 0.0012) * 0.5;
        // Inside: the middle of the spectrum stands for the beam's path through the glass.
        vec3 dMid = refract(dir, nIn, 1.0 / iorAt(0.5, disp));
        mat3 mid = throughGlass(entry, dMid, iorAt(0.5, disp));
        glassGlow += bc * beamGlow(ro, rd, entry, mid[0], 0.022, 0.0, 1e9) * 0.9;
        // The glass itself takes up a little of the light round the beam's path.
        glassGlow += mix(bc, palLight.rgb * e, 0.5) * beamGlow(ro, rd, entry, mid[0], 0.16, 0.0, 1e9) * 0.25;
        vec3 landR = vec3(0.0);
        vec3 landV = vec3(0.0);
        float okR = 0.0;
        float okV = 0.0;
        // Out: one ray per wavelength, each a soft beam wide enough to merge with its neighbors.
        for (int k = 0; k < NL; k++) {
            float x = float(k) / float(NL - 1);
            float n = iorAt(x, disp);
            vec3 d1 = refract(dir, nIn, 1.0 / n);
            mat3 tr = throughGlass(entry, d1, n);
            vec3 ex = tr[0];
            vec3 dOut = tr[1];
            vec3 sc = spectrum(x) / specSum * bc;
            float tg = dOut.y < -0.02 ? -ex.y / dOut.y : 6.0;
            vec3 land = ex + dOut * tg;
            // Each wavelength's beam widens enough to merge with its neighbors in the fan.
            float grow = 0.004 + (0.025 + 0.12 * disp) * 0.3;
            air += sc * beamGlow(ro, rd, ex, land, 0.024, grow, tStop) * hz * 0.8;
            if (k == 0) { landR = land; okR = dOut.y < -0.02 ? 1.0 : 0.0; }
            if (k == NL - 1) { landV = land; okV = dOut.y < -0.02 ? 1.0 : 0.0; }
        }
        // On the floor the fan lays down one continuous band of spectrum, red to violet.
        if (okR * okV > 0.5) {
            vec2 A = landR.xz;
            vec2 ab = landV.xz - A;
            float L2 = max(dot(ab, ab), 1e-5);
            vec2 q = gp.xz - A;
            float sb = clamp(dot(q, ab) / L2, 0.0, 1.0);
            vec2 dq = q - ab * sb;
            float wb = 0.07 + 0.03 * disp;
            float band = exp(-dot(dq, dq) / (wb * wb));
            vec3 sp = spectrum(sb) * float(NL) / specSum;
            floorLight += bc * sp * band * 0.75 / (1.0 + 3.0 * sqrt(L2));
        }
    }

    // The floor: dark, faintly the room's color, fading into the distance, lit where spectra land.
    vec3 col = vec3(0.0);
    float floorFade = exp(-max(length(gp.xz - vec2(0.8, 0.0)) - 1.5, 0.0) * 0.45);
    vec3 floorCol = (palGround.rgb * 0.03 + floorLight) * floorFade;
    // The prism's soft shadow under it, from the soft box overhead.
    vec2 sh = gp.xz - (gC.xz + vec2(0.15, 0.12));
    floorCol *= 1.0 - 0.5 * exp(-dot(sh, sh) / 0.35);

    col = (rd.y < 0.0 ? floorCol : vec3(0.0)) + air;
    if (onGlass > 0.5) {
        vec3 hp = ro + rdG * ghG.x;
        vec3 n = planeN(ghG.z);
        float cosi = clamp(dot(-rdG, n), 0.0, 1.0);
        float fr = 0.04 + 0.96 * pow(1.0 - cosi, 5.0);
        vec3 refl = studio(reflect(rdG, n)) * fr;
        // Refract each color channel with its own index, travel, absorb (Beer's law) and leave.
        vec3 absorb = (vec3(1.0) - palLight.rgb / max(max(palLight.r, palLight.g), max(palLight.b, 1e-3)) * 0.92) * (0.4 + 3.0 * clamp(depth, 0.0, 1.0));
        vec3 trans = vec3(0.0);
        for (int c = 0; c < 3; c++) {
            float fc = float(c);
            float n2 = iorAt(1.0 - fc * 0.5, disp);
            vec3 d1 = refract(rdG, n, 1.0 / n2);
            mat3 tr = throughGlass(hp, d1, n2);
            vec3 bg = studio(tr[1]);
            // What lies behind through the glass: the floor where the ray comes down.
            if (tr[1].y < 0.0) bg += palGround.rgb * 0.02;
            vec3 att = exp(-absorb * tr[2].y);
            vec3 v = bg * att * (1.0 - fr);
            if (c == 0) trans.r = v.r;
            if (c == 1) trans.g = v.g;
            if (c == 2) trans.b = v.b;
        }
        // Glass lets the floor and the far beams through, darkened.
        vec3 gcol = refl + trans + glassGlow + air * 0.8;
        // A faint tint of the glass's body color so it reads as a solid even in the dark.
        gcol += palLight.rgb * 0.008;
        col = mix(col, gcol, cov);
    }

    // Tone map on luminance so bright beams keep their color, then dither.
    float lum = max(max(col.r, col.g), col.b);
    col = col / max(lum, 1e-4) * (1.0 - exp(-lum * 1.4));
    col += (hash21(gl_FragCoord.xy + fract(TIME) * 91.7) - 0.5) / 255.0;
    col = max(col, 0.0);

    vec3 outc = col;
    float outa = 1.0;
    if (vxClear) {
        // Light is as solid as it is bright; the glass is a faint solid sheen over what is behind.
        float lightA = clamp(max(max(col.r, col.g), col.b), 0.0, 1.0);
        outa = max(lightA, 0.07 * cov);
        outc = min(col, vec3(outa));
    }
    gl_FragColor = vec4(outc, outa) * vxPresence;
}
